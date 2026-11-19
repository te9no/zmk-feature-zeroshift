import {Request, Response} from "./node_modules/@zmkfirmware/zmk-studio-ts-client/src/studio.ts";
import {get_encoder, get_decoder} from "./node_modules/@zmkfirmware/zmk-studio-ts-client/src/framing.ts";
import protobuf from "protobufjs";
import schema from "../proto/modules.proto";

import mekabuSchema from "../proto/mekabu.proto";

const mekabu = protobuf.parse(mekabuSchema).root;
const mekabuRequest = mekabu.lookupType("mekabu.Request");
const mekabuResponse = mekabu.lookupType("mekabu.Response");
const mekabuModes = ["off", "pmw3610", "stick", "encoder", "key", "rzt", "tpd", "lpps"];

const root = protobuf.parse(schema).root;
const request = root.lookupType("cagime.Request");
const response = root.lookupType("cagime.Response");
const names = ["off", "pmw3610", "lpps", "encoder", "stick", "key", "pat9125"];

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
  let subsystem;
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
      if (!subsystem) {
        const list = await invoke({listCustomSubsystems: {}});
        subsystem = list?.listCustomSubsystems?.subsystems.find(s =>
          ["cagime__modules", "mekabu__modules"].includes(s.identifier));
        if (!subsystem) throw new Error("ZeroShift 対応の左側ファームウェアを確認してください。");
      }
      const isMeKaBu = subsystem.identifier === "mekabu__modules";
      const index = subsystem.index;
      let operation = {get: true};
      if (modes) {
        const ids = modes.map(mode => (isMeKaBu ? mekabuModes : names).indexOf(mode));
        if (ids.length !== (isMeKaBu ? 1 : 2) || ids.includes(-1)) throw new Error("未対応のモジュールです。");
        operation = {set: isMeKaBu ? ids[0] : {lower: ids[0], inner: ids[1]}};
      }
      const payload = (isMeKaBu ? mekabuRequest : request).encode({right: side === "right", ...operation}).finish();
      const result = (await invoke({call: {subsystemIndex: index, payload}}))?.call;
      if (result?.subsystemIndex !== index) throw new Error("本体からの応答を確認できませんでした。");
      const {saved, active, supported, error} = (isMeKaBu ? mekabuResponse : response).decode(result.payload);
      if (side === "right" && [-110, -116, -11].includes(error)) {
        throw new Error("右側の応答を確認できません。電源と左右の接続を確認して再読込してください。");
      }
      if (isMeKaBu) {
        if (error || !mekabuModes[saved] || !mekabuModes[active]) throw new Error("設定を確認できませんでした（" + error + "）。");
        return {model: "MeKaBu", side, lower: mekabuModes[saved], activeLower: mekabuModes[active],
          innerEnabled: false, supported: {lower: mekabuModes}};
      }
      if (error || !saved || !active) throw new Error("設定を確認できませんでした（" + error + "）。");
      return {model: "CaGiMe", side, supported: supported && {lower: names.filter((_, i) => supported.lower & (1 << i)),
        inner: names.filter((_, i) => supported.inner & (1 << i))}, lower: names[saved.lower], inner: names[saved.inner],
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
