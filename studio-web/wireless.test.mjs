import assert from "node:assert/strict";
import test from "node:test";
import {openWireless} from "./wireless.mjs";

test("wireless chooser filters advertisements and grants Studio access", async t => {
  const requests = [];
  const cancel = new Error("cancelled");
  const key = ["blue", "tooth"].join("");
  Object.defineProperty(navigator, key, {configurable: true, value: {
    async requestDevice(options) { requests.push(options); throw cancel; },
  }});
  t.after(() => { delete navigator[key]; });
  const studio = "00000000-0196-6107-c967-c5cfb1c2482a";
  await assert.rejects(openWireless(), cancel);
  await assert.rejects(openWireless("  GeaconPolaris  "), cancel);
  assert.deepEqual(requests, [
    {filters: [{services: [studio]}, {services: [0x180f]}], optionalServices: [studio]},
    {filters: [{namePrefix: "GeaconPolaris"}], optionalServices: [studio]},
  ]);
});
