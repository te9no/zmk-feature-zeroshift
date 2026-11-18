#!/usr/bin/env python3
"""Exercise CaGiMe module selection and Zephyr NVS over a Renode UART."""

import argparse
import hashlib
import json
import re
import socket
import struct
import subprocess
import time
from itertools import product
from pathlib import Path
from tempfile import TemporaryDirectory

APP_START = 0x27000
SETTINGS_START = 0xEC000
SETTINGS_SIZE = 0x8000
SHELL_RESPONSE = re.compile(rb"(CAGIME/[12] (?:state [^\r\n]+|error -[0-9]+))[\r\n]")


def read_application(path):
    data = path.read_bytes()
    provenance = json.loads(path.with_suffix(".uf2.json").read_text())["artifact"]
    if provenance["name"] != path.name or provenance["sha256"] != hashlib.sha256(data).hexdigest():
        raise ValueError(f"{path}: UF2 provenance mismatch")
    block_size = 512
    payload_size = 256
    block_count, remainder = divmod(len(data), block_size)
    if not block_count or remainder or APP_START + block_count * payload_size > SETTINGS_START:
        raise ValueError(f"{path}: invalid UF2 size")

    payload = bytearray()
    for number in range(block_count):
        start = number * block_size
        block = data[start : start + block_size]
        address = APP_START + number * payload_size
        expected = (0x0A324655, 0x9E5D5157, 0x2000, address, payload_size, number, block_count, 0xADA52840)
        if struct.unpack_from("<8I", block) != expected or block[-4:] != bytes.fromhex("306fb10a"):
            raise ValueError(f"{path}: invalid nRF52840 UF2 block {number}")
        payload.extend(block[32 : 32 + payload_size])
    return payload


def port_number():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def connect(port, process):
    until = time.monotonic() + 15
    while time.monotonic() < until and process.poll() is None:
        try:
            return socket.create_connection(("127.0.0.1", port), timeout=0.25)
        except OSError:
            time.sleep(0.05)
    raise RuntimeError("Renode UART did not open")


def check_shell(process, line_log, terminal, side, legacy):
    def monitor(command):
        process.stdin.write(command + "\n")
        process.stdin.flush()

    def expect(command, wanted, retry=False):
        wanted = f"CAGIME/{1 if legacy else 2} {wanted}"
        data = bytearray()
        until = time.monotonic() + 10
        while time.monotonic() < until:
            terminal.sendall(f"cagime {command}\r".encode())
            attempt = time.monotonic() + (0.5 if retry else 5)
            while time.monotonic() < attempt:
                try:
                    chunk = terminal.recv(4096)
                except TimeoutError:
                    continue
                if not chunk:
                    raise RuntimeError("Renode UART closed")
                data.extend(chunk)
                line_log.write(chunk)
                for response in SHELL_RESPONSE.findall(data):
                    actual = response.decode().strip()
                    if actual == wanted:
                        print(f"{side}: {command} -> {actual}", flush=True)
                        return
                    if not retry:
                        raise AssertionError(f"{side}: got {actual!r}, expected {wanted!r}")
            if not retry:
                break
        raise AssertionError(f"{side}: missing {wanted!r}; got {bytes(data)[-500:]!r}")

    def state(saved, active):
        return f"state {side} {saved} {active} 1"

    def reboot():
        monitor("pause")
        monitor("machine Reset")
        # The test loads the application partition directly, starting at 0x27000.
        monitor(f"sysbus.cpu VectorTableOffset {APP_START:#x}")
        monitor("start")

    monitor("start")
    expect("get", state("off off", "off off"), retry=True)
    expect("set lpps off", "error -22")
    expect("set off stick", "error -22")
    expect("set unexpected off", "error -22")
    expect("get", state("off off", "off off"))

    lower_modes = ["off", "pmw3610"]
    inner_modes = ["off", "pmw3610", "lpps"]
    if not legacy:
        lower_modes.extend(("encoder", "stick", "key"))
        inner_modes.extend(("encoder", "key"))

    # End at off/off so it is also verified through a write followed by a reset.
    profiles = [f"{lower} {inner}" for lower, inner in product(lower_modes, inner_modes)]
    profiles.append(profiles.pop(0))
    previous = "off off"
    for profile in profiles:
        expect(f"set {profile}", state(profile, previous))
        reboot()
        expect("get", state(profile, profile), retry=True)
        previous = profile

    print(f"{side}: {len(profiles)}/{len(profiles)} configurations saved and applied", flush=True)


def board_model(renode, legacy=False):
    board = renode.parent / "platforms/cpus/nrf52840.repl"
    platform = board.read_text()
    twi = "twi0: I2C.NRF52840_I2C @ sysbus 0x40003000\n    -> nvic@0x3"
    spim = """spi0: SPI.NRF52840_SPI @ sysbus 0x40003000
    easyDMA: true
    -> nvic@3"""
    if twi not in platform:
        raise RuntimeError("Expected Renode 1.17.0 nRF52840 platform layout")
    platform = platform.replace(twi, spim) + """
spi3: SPI.NRF52840_SPI @ sysbus 0x4002F000
    easyDMA: true
    -> nvic@47

ficr: Memory.MappedMemory @ sysbus 0x10000000
    size: 0x1000

uicr: Memory.MappedMemory @ sysbus 0x10001000
    size: 0x1000
"""
    adc_model = Path(__file__).resolve().with_name("NRF52840_StickAdc.cs")
    include_adc = ""
    if not legacy:
        platform += """\nsaadc: Mocks.NRF52840_StickAdc @ sysbus 0x40007000
    IRQ -> nvic@7
"""
        include_adc = f"include @{adc_model}\n"

    return platform, include_adc


def run_side(renode, firmware_dir, log_root, side, legacy):
    platform, include_adc = board_model(renode, legacy)
    uf2 = firmware_dir / f"cagime-aaa-r01-renode-{side}.uf2"
    with TemporaryDirectory(prefix=f"cagime-{side}-") as temp:
        tmp = Path(temp)
        (tmp / "cagime.repl").write_text(platform)
        (tmp / "blank.bin").write_bytes(b"\xff" * SETTINGS_SIZE)
        (tmp / "app.bin").write_bytes(read_application(uf2))
        port = port_number()
        (tmp / "boot.resc").write_text(f'''
mach create "{side}"
{include_adc}machine LoadPlatformDescription @{tmp / "cagime.repl"}
sysbus WriteDoubleWord 0x10000010 4096
sysbus WriteDoubleWord 0x10000014 256
sysbus WriteDoubleWord 0x10001200 18
sysbus WriteDoubleWord 0x10001204 18
sysbus WriteDoubleWord 0x1000120c 0xfffffffe
sysbus LoadBinary @{tmp / "blank.bin"} {SETTINGS_START:#x}
sysbus LoadBinary @{tmp / "app.bin"} {APP_START:#x}
sysbus.cpu VectorTableOffset {APP_START:#x}
emulation CreateServerSocketTerminal {port} "uart_term" false
connector Connect sysbus.uart0 uart_term
''')
        with (log_root / f"{side}-renode.log").open("wb") as emulator_log:
            process = subprocess.Popen(
                [renode, "--disable-xwt", "--console", "--plain", tmp / "boot.resc"],
                stdin=subprocess.PIPE,
                stdout=emulator_log,
                stderr=subprocess.STDOUT,
                text=True,
            )
            try:
                with connect(port, process) as terminal, (log_root / f"{side}-uart.log").open("wb") as uart_log:
                    check_shell(process, uart_log, terminal, side, legacy)
            finally:
                if process.poll() is None:
                    try:
                        process.stdin.write("quit\n")
                        process.stdin.flush()
                        process.wait(timeout=3)
                    except (BrokenPipeError, subprocess.TimeoutExpired):
                        process.kill()
                        process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--renode", required=True, type=Path)
    parser.add_argument("--firmware-dir", required=True, type=Path)
    parser.add_argument("--log-root", required=True, type=Path)
    parser.add_argument("--legacy", action="store_true", help="test the six CAGIME/1 profiles")
    args = parser.parse_args()
    args.log_root.mkdir(parents=True, exist_ok=True)
    for side in ("left", "right"):
        run_side(args.renode.resolve(), args.firmware_dir, args.log_root, side, args.legacy)


if __name__ == "__main__":
    main()
