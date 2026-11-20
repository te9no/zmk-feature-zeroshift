import assert from "node:assert/strict";
import test from "node:test";
import {moduleSession} from "./dist/rpc.mjs";

test("a timed-out request releases the port while its USB write is still pending", async t => {
  t.mock.timers.enable({apis: ["setTimeout"]});
  let started, finish;
  const writing = new Promise(resolve => { started = resolve; });
  const transport = {
    abortController: new AbortController(),
    readable: new ReadableStream(),
    writable: new WritableStream({write() {
      started();
      return new Promise(resolve => { finish = resolve; });
    }}),
  };
  const session = moduleSession(transport);
  const request = assert.rejects(session.profile("left"));
  await writing;
  t.mock.timers.tick(6000);
  assert.match(transport.abortController.signal.reason.message, /タイムアウト/);
  await session.close();
  await request;
  assert.equal(transport.readable.locked, false);
  assert.equal(transport.writable.locked, false);
  finish();
});

for (const end of ["close", "error"]) {
  test(`an idle receive stream ending with ${end} disconnects the session`, async () => {
    let input;
    const transport = {
      abortController: new AbortController(),
      readable: new ReadableStream({start(controller) { input = controller; }}),
      writable: new WritableStream(),
    };
    const session = moduleSession(transport);
    const disconnected = new Promise(resolve =>
      transport.abortController.signal.addEventListener("abort", resolve, {once: true}));
    input[end]();
    await disconnected;
    await session.close();
    assert.equal(transport.readable.locked, false);
    assert.equal(transport.writable.locked, false);
  });
}
