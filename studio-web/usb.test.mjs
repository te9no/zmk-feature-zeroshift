import assert from "node:assert/strict";
import test from "node:test";
import {usbConnection} from "./usb.mjs";

function fixture(transfers) {
  const endpoints = [{direction: "in", endpointNumber: 3, packetSize: 64}, {direction: "out", endpointNumber: 2}];
  const device = {
    configurations: [{interfaces: [2, 10].map((interfaceClass, interfaceNumber) =>
      ({interfaceNumber, alternates: [{interfaceClass, endpoints}]}))}],
    configuration: {}, opened: false,
    async open() { this.opened = true; },
    async close() { this.opened = false; },
    async claimInterface() {},
    async controlTransferOut() { return {status: "ok"}; },
    async transferIn(endpoint, size) {
      assert.equal(endpoint, 3);
      assert.ok(size >= 64);
      assert.ok(transfers.length);
      return transfers.shift();
    },
  };
  return usbConnection({usb: {requestDevice: async () => device}}, true).requestPort();
}

test("read Studio data after consecutive USB zero-length packets", async () => {
  const data = Uint8Array.of(0, 0xab, 0xcd, 0);
  const empty = {status: "ok", data: new DataView(new ArrayBuffer(0))};
  const port = await fixture([empty, empty, {status: "ok", data: new DataView(data.buffer, 1, 2)}]);
  await port.open({baudRate: 115200});
  const reader = port.readable.getReader();
  assert.deepEqual((await reader.read()).value, Uint8Array.of(0xab, 0xcd));
  reader.releaseLock();
  await port.close();
});

test("surface failed USB transfers", async () => {
  const port = await fixture([{status: "stall"}]);
  await port.open({baudRate: 115200});
  const reader = port.readable.getReader();
  await assert.rejects(reader.read(), /stall/);
  reader.releaseLock();
  await port.close();
});
