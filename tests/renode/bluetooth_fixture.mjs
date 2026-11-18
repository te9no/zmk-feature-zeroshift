// A Web Bluetooth test double backed by the Renode Studio UART.
import assert from "node:assert/strict";
import {openBluetooth} from "../../studio-web/bluetooth.mjs";

export async function bluetoothFixture(socket) {
  const device = new EventTarget();
  const characteristic = new EventTarget();
  characteristic.writeValueWithResponse = bytes => new Promise((resolve, reject) => {
    assert.ok(bytes.length <= 20);
    socket.write(bytes, error => error ? reject(error) : resolve());
  });
  function notify(bytes) {
    for (let start = 0; start < bytes.length; start += 20) {
      characteristic.value = new DataView(bytes.buffer, bytes.byteOffset + start, Math.min(20, bytes.length - start));
      characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
    }
  }
  characteristic.startNotifications = async () => socket.on("data", notify);
  device.gatt = {
    async connect() { this.connected = true; return this; },
    async getPrimaryService(uuid) {
      assert.equal(uuid, "00000000-0196-6107-c967-c5cfb1c2482a");
      return {async getCharacteristic(uuid) {
        assert.equal(uuid, "00000001-0196-6107-c967-c5cfb1c2482a");
        return characteristic;
      }};
    },
    disconnect() {
      this.connected = false;
      socket.off("data", notify);
      device.dispatchEvent(new Event("gattserverdisconnected"));
    },
  };
  Object.defineProperty(navigator, "bluetooth", {value: {requestDevice: async () => device}});
  return openBluetooth();
}
