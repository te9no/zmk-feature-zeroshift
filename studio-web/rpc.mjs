import {Request, Response} from "./node_modules/@zmkfirmware/zmk-studio-ts-client/src/studio.ts";
import {get_encoder, get_decoder} from "./node_modules/@zmkfirmware/zmk-studio-ts-client/src/framing.ts";
import protobuf from "protobufjs";
import schema from "../proto/modules.proto";

const root = protobuf.parse(schema).root;
const request = root.lookupType("cagime.Request");
const response = root.lookupType("cagime.Response");
const names = ["off", "pmw3610", "lpps", "encoder", "stick", "key"];

export function moduleSession(transport) {
  const signal = transport.abortController.signal;
  const tx = new TransformStream(get_encoder());
  const rx = new TransformStream(get_decoder());
  const pipes = Promise.allSettled([
    tx.readable.pipeTo(transport.writable, {signal, preventAbort: true}),
    transport.readable.pipeTo(rx.writable, {signal}),
  ]);
  const reader = rx.readable.getReader();
  const writer = tx.writable.getWriter();
  let sequence = 0;
  let index;
  async function invoke(custom) {
    const requestId = ++sequence;
    const timer = setTimeout(() => transport.abortController.abort(
      new Error("通信がタイムアウトしました。本体に再接続してください。")), 6000);
    try {
      await writer.write(Request.encode({requestId, custom}).finish());
      for (;;) {
        const {value, done} = await reader.read();
        if (done) throw new Error("接続が切れました。");
        const reply = Response.decode(value).requestResponse;
        if (reply?.requestId === requestId) return reply.custom;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async profile(side, modes) {
      if (index === undefined) {
        const list = await invoke({listCustomSubsystems: {}});
        index = list?.listCustomSubsystems?.subsystems.find(s => s.identifier === "cagime__modules")?.index;
        if (index === undefined) throw new Error("CaGiMe Studio 対応の左側 UF2 を確認してください。");
      }
      const operation = modes ? {set: {lower: names.indexOf(modes[0]), inner: names.indexOf(modes[1])}} : {get: true};
      const payload = request.encode({right: side === "right", ...operation}).finish();
      const result = (await invoke({call: {subsystemIndex: index, payload}}))?.call;
      if (result?.subsystemIndex !== index) throw new Error("本体からの応答を確認できませんでした。");
      const {saved, active, error} = response.decode(result.payload);
      if (error === -116 || error === -11 && side === "right") {
        throw new Error("右側の応答を確認できません。電源と左右の接続を確認して再読込してください。");
      }
      if (error || !saved || !active) throw new Error("設定を確認できませんでした（" + error + "）。");
      return {side, lower: names[saved.lower], inner: names[saved.inner],
        activeLower: names[active.lower], activeInner: names[active.inner], innerEnabled: true, allModules: true};
    },
    async close() {
      transport.abortController.abort();
      await pipes;
      reader.releaseLock();
      writer.releaseLock();
    },
  };
}
