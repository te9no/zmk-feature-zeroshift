import assert from "node:assert/strict";
import test from "node:test";
import {parseDescriptor, describedProfile} from "./descriptor.mjs";
const slot = (label, id) => ({label, modes: [[0, "off"], [id, label]]});
const parse = value => parseDescriptor(new TextEncoder().encode(JSON.stringify(value)));
test("new keyboard and non-contiguous slot IDs come from firmware", async () => {
  const d = parse({model: "Fixture", central: "right", right: [slot("A", 19), slot("B", 255)], left: [slot("C", 9)]});
  const result = await describedProfile(async bytes => {
    assert.deepEqual([...bytes], [2, 1, 19, 255]);
    return Uint8Array.of(0, 0, 0, 0, 19, 255, 0, 255);
  }, d, undefined, [19, 255]);
  assert.deepEqual(result.slots.map(s => [s.saved, s.active]), [[19, 0], [255, 255]]);
  await assert.rejects(describedProfile(() => assert.fail(), d, "left", [19]));
  await assert.rejects(describedProfile(async () => Uint8Array.of(0,0,0,0,255,0), d, "left"));
});
test("reject ambiguous mode IDs", () => {
  assert.throws(() => parse({model: "Fixture", central: "left", slots: [slot("bad", 0)]}));
});
