import assert from "node:assert/strict";
import net from "node:net";
import {Duplex} from "node:stream";
import {once} from "node:events";
import {createInterface} from "node:readline/promises";
import {setTimeout as delay} from "node:timers/promises";
import {moduleSession} from "../../studio-web/dist/rpc.mjs";

const socket = net.connect(Number(process.argv[2]), "127.0.0.1");
await once(socket, "connect");
const transport = process.env.CAGIME_TEST_WEB_BLUETOOTH === "1"
  ? await (await import("./bluetooth_fixture.mjs")).bluetoothFixture(socket)
  : {...Duplex.toWeb(socket), abortController: new AbortController()};
const session = moduleSession(transport);
const monitor = createInterface({input: process.stdin, output: process.stdout});
async function reset(side) {
  await monitor.question("RESET " + side + "\n");
  await delay(600);
}
function check(state, saved, active) {
  assert.deepEqual([state.lower, state.inner], saved);
  assert.deepEqual([state.activeLower, state.activeInner], active);
}
async function readAfterBoot(side) {
  // The wired transport becomes available after its heartbeat handshake.
  for (let attempt = 0; ; attempt++) {
    try {
      return await session.profile(side);
    } catch (error) {
      if (side !== "right" || !error.message.includes("右側の応答") || attempt >= 4) throw error;
      await delay(500);
    }
  }
}
await delay(1500);
for (const side of ["left", "right"]) {
  let previous = ["off", "off"];
  check(await readAfterBoot(side), previous, previous);
  await assert.rejects(session.profile(side, ["lpps", "off"]), /-22/);
  await assert.rejects(session.profile(side, ["off", "stick"]), /-22/);
  const cases = ["off","pmw3610","encoder","stick","key"].flatMap(lower =>
    ["off","pmw3610","lpps","encoder","key"].map(inner => [lower, inner]));
  cases.push(cases.shift());
  for (const modes of cases) {
    check(await session.profile(side, modes), modes, previous);
    if (modes === cases[0]) {
      check(await readAfterBoot(side === "left" ? "right" : "left"), ["off", "off"], ["off", "off"]);
    }
    await reset(side);
    check(await readAfterBoot(side), modes, modes);
    console.log(side, ...modes, "PASS");
    previous = modes;
  }
  console.log(side, "25/25");
}
await session.close();
socket.destroy();
process.exit(0);
