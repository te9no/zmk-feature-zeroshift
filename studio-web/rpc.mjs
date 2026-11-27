import {parseDescriptor, describedProfile} from "./descriptor.mjs";
import {Request, Response} from "./node_modules/@zmkfirmware/zmk-studio-ts-client/src/studio.ts";
import {get_encoder, get_decoder} from "./node_modules/@zmkfirmware/zmk-studio-ts-client/src/framing.ts";
import protobuf from "protobufjs";
import schema from "../proto/modules.proto";

import mekabuSchema from "../proto/mekabu.proto";

const mekabu = protobuf.parse(mekabuSchema).root;
const mekabuRequest = mekabu.lookupType("mekabu.Request");
const mekabuResponse = mekabu.lookupType("mekabu.Response");
const mekabuModes = ["off", "pmw3610", "stick", "encoder", "key", "rzt", "tpd", "lpps", "pat9125"];

const anantaModes = ["off", "pmw3610", "stick", "encoder", "key", "tpd", "iqs", "lpps", "pat9125"];

const root = protobuf.parse(schema).root;
const request = root.lookupType("cagime.Request");
const response = root.lookupType("cagime.Response");
const names = ["off", "pmw3610", "lpps", "encoder", "stick", "key", "pat9125", "tpd"];

export function moduleSession(transport) {
  const signal = transport.abortController.signal;
  const tx = new TransformStream(get_encoder());
  const rx = new TransformStream(get_decoder());
  const reader = rx.readable.getReader();
  const writer = tx.writable.getWriter();
  const frames = tx.readable.getReader();
  const output = transport.writable.getWriter();

  function transportEnded(error) {
    if (!signal.aborted) transport.abortController.abort(
      new Error("接続が切れました。本体に再接続してください。", {cause: error}));
  }
  output.closed.then(transportEnded, transportEnded);
  const receiving = transport.readable.pipeTo(rx.writable, {signal}).then(transportEnded, transportEnded);

  async function sendFrames() {
    try {
      while (!signal.aborted) {
        const {value, done} = await frames.read();
        if (done || signal.aborted) return;
        await output.write(value);
      }
    } catch (error) {
      transportEnded(error);
    }
  }
  void sendFrames();
  let sequence = 0;
  let subsystem;
  let descriptor;
  const capabilities = new Map();
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
        const available = list?.listCustomSubsystems?.subsystems ?? [];
        subsystem = available.find(s => s.identifier === "zeroshift__v1") ?? available.find(s =>
          ["cagime__modules", "mekabu__modules", "saa__modules"].includes(s.identifier));
        if (!subsystem) throw new Error("ZeroShift 対応の親機ファームウェアを確認してください。");
      }
      if (subsystem.identifier === "zeroshift__v1") {
        const call = async payload => {
          const reply = (await invoke({call: {subsystemIndex: subsystem.index, payload}}))?.call;
          if (reply?.subsystemIndex !== subsystem.index) throw new Error("本体からの応答を確認できませんでした。");
          return reply.payload;
        };
        descriptor ??= parseDescriptor(await call(Uint8Array.of(0)));
        return {...await describedProfile(call, descriptor, side, modes), central: descriptor.central};
      }
      const ananta = subsystem.identifier === "saa__modules";
      side ??= ananta ? "right" : "left";
      const singleSlot = subsystem.identifier === "mekabu__modules";
      const modeNames = ananta ? anantaModes : singleSlot ? mekabuModes : names;
      const legacy = mekabuModes.slice(0, 8);
      const index = subsystem.index;
      let operation = {get: true};
      if (modes) {
        const ids = modes.map((mode, slot) => {
          const known = capabilities.get(side);
          const allowed = known?.[slot === 0 ? "lower" : "inner"] ?? (singleSlot ? legacy : modeNames);
          return allowed.includes(mode) ? modeNames.indexOf(mode) : -1;
        });
        if (ids.length !== (singleSlot ? 1 : 2) || ids.includes(-1)) throw new Error("未対応のモジュールです。");
        operation = {set: singleSlot ? ids[0] : {lower: ids[0], inner: ids[1]}};
      }
      const payload = (singleSlot ? mekabuRequest : request).encode({right: side === "right", ...operation}).finish();
      const result = (await invoke({call: {subsystemIndex: index, payload}}))?.call;
      if (result?.subsystemIndex !== index) throw new Error("本体からの応答を確認できませんでした。");
      const {saved, active, supported: mask, error} = (singleSlot ? mekabuResponse : response).decode(result.payload);
      if (side === (ananta ? "left" : "right") && [-110, -116, -11].includes(error)) {
        throw new Error((ananta ? "左側" : "右側") + "の応答を確認できません。電源と左右の接続を確認して再読込してください。");
      }
      if (singleSlot) {
        const supported = mask ? modeNames.filter((_, i) => mask & (1 << i)) : legacy;
        capabilities.set(side, {lower: supported});
        if (error || !supported.includes(modeNames[saved]) || !supported.includes(modeNames[active])) throw new Error("設定を確認できませんでした（" + error + "）。");
        return {model: "MeKaBu", side, lower: modeNames[saved], activeLower: modeNames[active],
          innerEnabled: false, supported: {lower: supported}};
      }
      if (error || !saved || !active) throw new Error("設定を確認できませんでした（" + error + "）。");
      const supported = mask && {lower: modeNames.filter((_, i) => mask.lower & (1 << i)),
        inner: modeNames.filter((_, i) => mask.inner & (1 << i))};
      capabilities.set(side, supported);
      return {model: ananta ? "Ananta" : "CaGiMe", side, supported, lower: modeNames[saved.lower], inner: modeNames[saved.inner],
        activeLower: modeNames[active.lower], activeInner: modeNames[active.inner], innerEnabled: true, allModules: true};
    },
    async close() {
      transport.abortController.abort();
      // Release the physical writer even if its last USB transfer is pending.
      // Closing the port can then interrupt the transfer.
      output.releaseLock();
      await Promise.allSettled([frames.cancel(), reader.cancel(), receiving]);
      frames.releaseLock();
      reader.releaseLock();
      writer.releaseLock();
    },
  };
}
