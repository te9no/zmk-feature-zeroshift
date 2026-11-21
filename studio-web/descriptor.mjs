// All labels and mode IDs come from the connected keyboard's versioned endpoint.
const label = value => typeof value === "string" && value.trim().length > 0 && value.length <= 128;
const invalid = () => new Error("キーボードのスロット定義を読み取れませんでした。");

export function parseDescriptor(bytes) {
  const d = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
  if (!label(d.model) || !["left", "right"].includes(d.central)) throw invalid();
  for (const side of ["left", "right"]) {
    const slots = d[side] ?? d.slots;
    if (!Array.isArray(slots) || !slots.length || slots.length > 255) throw invalid();
    for (const slot of slots) {
      if (!slot || !label(slot.label) || !Array.isArray(slot.modes) || !slot.modes.length || slot.modes.length > 256) throw invalid();
      const ids = new Set();
      for (const option of slot.modes) {
        if (!Array.isArray(option) || option.length !== 2) throw invalid();
        const [id, name] = option;
        if (!Number.isInteger(id) || id < 0 || id > 255 || ids.has(id) || !label(name)) throw invalid();
        ids.add(id);
      }
      if (!ids.has(0)) throw invalid();
    }
    d[side] = slots;
  }
  return d;
}

export async function describedProfile(call, descriptor, side = descriptor.central, requested) {
  if (!["left", "right"].includes(side)) throw invalid();
  const slots = descriptor[side];
  if (requested !== undefined && (!Array.isArray(requested) || requested.length !== slots.length ||
      slots.some((slot, i) => !slot.modes.some(([id]) => id === requested[i]))))
    throw new Error("未対応のモジュールです。");
  const reply = await call(Uint8Array.from([requested ? 2 : 1, Number(side === "right"), ...(requested ?? [])]));
  if (reply.length < 4) throw invalid();
  const err = new DataView(reply.buffer, reply.byteOffset, reply.byteLength).getInt32(0, true);
  if (err) {
    const which = side === "left" ? "左側" : "右側";
    throw new Error(which + "の応答を確認できません（" + err + "）。");
  }
  if (reply.length !== 4 + 2 * slots.length) throw invalid();
  return {model: descriptor.model, side, slots: slots.map((slot, i) => {
    const saved = reply[4+i], active = reply[4+slots.length+i];
    if (![saved, active].every(value => slot.modes.some(([id]) => id === value))) throw invalid();
    return {...slot, saved, active};
  })};
}
