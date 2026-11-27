// Turns a profile reply into the slot cards the page draws. Keyboards with a
// descriptor name their own modes; older firmware uses the fixed names below.

const legacyModes = {
  off: ["オフ"],
  pmw3610: ["トラックボール", "PMW3610"],
  encoder: ["エンコーダ"],
  pat9125: ["光学エンコーダ", "PAT9125"],
  lpps: ["LPPS", "ADS1220"],
  stick: ["アナログスティック"],
  key: ["1uキー"],
  iqs: ["トラックパッド", "IQS9151"],
  rzt: ["RZT"],
  tpd: ["Cirque タッチパッド"],
};
const legacyIcons = {iqs: "tpd"};

// Firmware without a capability list offers "base" modes only. "extended"
// modes need newer firmware, and "mekabu" modes exist only on MeKaBu.
const legacySlots = {
  lower: [["off"], ["pmw3610"], ["encoder"], ["pat9125", "extended"], ["lpps", "extended"], ["stick"], ["key"],
    ["iqs", "mekabu"], ["rzt", "mekabu"], ["tpd", "mekabu"]],
  inner: [["off"], ["pmw3610"], ["lpps"], ["encoder"], ["pat9125", "extended"], ["tpd", "mekabu"], ["iqs", "mekabu"], ["key"]],
};

const iconRules = [
  [/pat9125|光学/i, "pat9125"],
  [/pmw|トラックボール|trackball/i, "pmw3610"],
  [/エンコーダ|encoder/i, "encoder"],
  [/lpps|ads1220/i, "lpps"],
  [/スティック|stick/i, "stick"],
  [/rzt/i, "rzt"],
  [/パッド|iqs|cirque|tpd/i, "tpd"],
  [/キー|key/i, "key"],
];

// Only the part before the brackets names the module: "四連 LED（左 Cirque と排他）" is not a touchpad.
// ID 0 is not always an empty socket: a display slot may call it "標準".
export function iconFor(id, name) {
  const [kind] = splitName(name);
  if (id === 0 && /オフ|off|なし|無効/i.test(kind)) return "off";
  return iconRules.find(([pattern]) => pattern.test(kind))?.[1] ?? "module";
}

// "トラックボール（PMW3610）" → ["トラックボール", "PMW3610"]
export function splitName(name) {
  const match = /^(.+?)\s*[（(]([^（()）]+)[）)]$/.exec(name.trim());
  return match ? [match[1], match[2]] : [name.trim()];
}

export const modeLabel = mode => mode.detail ? mode.name + "（" + mode.detail + "）" : mode.name;

function legacyMode(id) {
  const [name, detail] = legacyModes[id] ?? [String(id)];
  return {id, name, detail, icon: legacyIcons[id] ?? id};
}

export function slotsOf(state, {demo = false} = {}) {
  if (state.slots) {
    return state.slots.map(({label, modes, saved, active}) => {
      const cards = modes.map(([id, text]) => {
        const [name, detail] = splitName(text);
        return {id, name, detail, icon: iconFor(id, text)};
      });
      return {label, connector: "", modes: cards, saved, active, activeMode: cards.find(mode => mode.id === active)};
    });
  }
  const ananta = state.model === "Ananta";
  const left = state.side === "left";
  const keys = state.innerEnabled ? ["lower", "inner"] : ["lower"];
  return keys.map(key => {
    const saved = state[key];
    const active = state[key === "lower" ? "activeLower" : "activeInner"];
    // Always offer the stored choice so firmware without a capability list can keep it.
    const listed = legacySlots[key].filter(([id, group]) => id === saved || (state.supported
      ? state.supported[key]?.includes(id)
      : group !== "mekabu" && (group !== "extended" || demo))).map(([id]) => id);
    // A keyboard may report a mode this slot's list does not name; it stays selectable.
    const reported = [saved, ...(state.supported?.[key] ?? [])].filter(id => id in legacyModes && !listed.includes(id));
    const modes = [...listed, ...new Set(reported)].map(legacyMode);
    const label = key === "inner" ? (ananta ? "上部" : "中央側") : state.innerEnabled ? "下側" : "拡張ソケット";
    const connector = ananta || !state.innerEnabled ? "" : key === "lower" ? (left ? "J4" : "J7") : left ? "J5" : "J8";
    return {label, connector, modes, saved, active, activeMode: legacyMode(active)};
  });
}

export const needsRestart = slots => slots.some(slot => slot.saved !== slot.active);

// The half that holds the Studio connection. Resetting it drops the session.
export function centralSide(state) {
  return state.central ?? (state.model === "Ananta" ? "right" : "left");
}
