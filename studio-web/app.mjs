import { moduleSession } from "./rpc.mjs";
import { openWireless, wirelessAdapter } from "./wireless.mjs";
const wireless = document.querySelector("#wireless");
const target = document.querySelector("#target");
const selectedSide = () => target.querySelector(":checked").value;
const reload = document.querySelector("#reload");

const connection = document.querySelector("#connection");
const side = document.querySelector("#side");
const status = document.querySelector("#status");
const form = document.querySelector("#modules");
const lower = document.querySelector("#lower");
const inner = document.querySelector("#inner");
const save = document.querySelector("#save");
const mode = {
  rzt: "RZT",
  tpd: "トラックパッド",
  off: "オフ",
  pmw3610: "トラックボール（PMW3610）",
  lpps: "LPPS（ADS1220）",
  encoder: "エンコーダ",
  pat9125: "光学エンコーダ（PAT9125）",
  stick: "アナログスティック",
  key: "1uキー",
};
const demo = document.querySelector("#demo");
const restart = document.querySelector("#restart");
const initialStatus = status.textContent;

function demoSession() {
  const profiles = {};
  for (const side of ["left", "right"]) {
    profiles[side] = {side, lower: "off", inner: "off", activeLower: "off", activeInner: "off",
      innerEnabled: true, allModules: true};
  }
  return {
    profile(side, modes) {
      const profile = profiles[side];
      if (modes) [profile.lower, profile.inner] = modes;
      return {...profile};
    },
    restart(side) {
      const profile = profiles[side];
      profile.activeLower = profile.lower;
      profile.activeInner = profile.inner;
    },
  };
}

let link;
let port;
let session;
let state;
let busy = false;
let generation = 0;
const drafts = new Map();

function updateControls() {
  document.querySelector("#target-bar").hidden = !session;
  document.querySelector("#help").hidden = !!session;
  side.dataset.connected = String(!!state);
  target.disabled = reload.disabled = busy;
  const inDemo = !!session?.restart;
  demo.hidden = !!session && !inDemo;
  demo.disabled = restart.disabled = busy;
  demo.textContent = inDemo ? "デモを終了" : "デモモード";
  restart.hidden = !inDemo;
  connection.hidden = !!session && link !== "USB";
  wireless.hidden = !!session && link !== "無線";
  wireless.disabled = busy || !wirelessAdapter();
  wireless.textContent = session ? "無線切断" : "無線接続";
  connection.disabled = busy || !navigator.serial;
  connection.textContent = session ? "USB 切断" : "USB 接続";
  lower.disabled = busy;
  inner.disabled = busy || !state?.innerEnabled;
  const edited = state && (form.elements.namedItem("lowerMode").value !== state.lower || (state.innerEnabled && form.elements.namedItem("innerMode").value !== state.inner));
  save.disabled = busy || !edited;
  document.querySelector("#edit-state").textContent = edited ? "未保存の変更あり" : "";
}

function render(next) {
  state = next;
  form.hidden = !state;
  if (!state) {
    side.textContent = session ? link + " 接続中" : "未接続";
    updateControls();
    return;
  }

  const left = state.side === "left";
  side.textContent = (session?.restart ? "デモ · " : "") + (state.model || "CaGiMe") + " · " + (left ? "左側の設定" : "右側の設定");
  document.querySelector("#slot-name").textContent = state.innerEnabled ? "下側" : "拡張ソケット";
  inner.closest(".slot").hidden = !state.innerEnabled;
  document.querySelector("#lower-connector").textContent = state.innerEnabled ? (left ? "J4" : "J7") : "";
  document.querySelector("#inner-connector").textContent = left ? "J5" : "J8";
  for (const group of [lower, inner]) {
    for (const input of group.querySelectorAll("input")) {
      const label = input.closest("label");
      const allowed = state.supported ? state.supported[group.id]?.includes(input.value)
        : !label.hasAttribute("data-mekabu") && (!label.hasAttribute("data-extended") || !!session?.restart);
      label.hidden = input.disabled = !allowed;
      input.checked = input.value === (drafts.get(state.side)?.[group.id] ?? state[group.id]);
    }
  }
  document.querySelector("#lower-state").textContent = "起動中：" + mode[state.activeLower];
  document.querySelector("#inner-state").textContent = state.innerEnabled
    ? "起動中：" + mode[state.activeInner]
    : "このファームウェアでは中央側を設定できません。";
  updateControls();
}

function currentStatus() {
  if (state.lower !== state.activeLower || state.inner !== state.activeInner) {
    if (session?.restart) return "デモに保存しました。「デモで再起動」を押すと、この側の起動時のドライバーが切り替わります。";
    return "保存済みの設定を反映するには、設定した側をリセットして、再読込してください。左側をリセットした場合は 再接続してください。";
  }
  if (session?.restart) return "デモの設定はこの画面内で有効です。デモを終了すると初期状態に戻ります。";
  return "本体から設定を読み取りました。";
}

async function disconnect(message) {
  const closing = ++generation;
  busy = true;
  drafts.clear();
  const previous = session;
  session = undefined;
  const oldPort = port;
  port = undefined;
  render(undefined);
  status.textContent = message.replaceAll(new RegExp(["blue", "tooth"].join(""), "gi"), "無線");
  try {
    await previous?.close();
  } finally {
    if (oldPort?.readable) await oldPort.close().catch(() => {});
    if (closing === generation) {
      busy = false;
      updateControls();
    }
  }
}

async function connect(kind) {
  if (busy) return;
  if (session) {
    await disconnect("左側を USB または 無線 で接続してください。");
    return;
  }
  const opening = ++generation;
  busy = true;
  updateControls();
  try {
    link = kind;
    let transport;
    if (kind === "無線") {
      transport = await openWireless();
    } else {
      const selected = await navigator.serial.requestPort({filters: [{usbVendorId: 0x1d50, usbProductId: 0x615e}]});
      port = selected;
      await selected.open({baudRate: 115200});
      if (opening !== generation) return;
      await selected.setSignals({dataTerminalReady: true});
      if (opening !== generation) return;
      transport = {readable: port.readable, writable: port.writable, abortController: new AbortController()};
    }
    status.textContent = "本体の設定を読み取っています。";
    const current = moduleSession(transport);
    session = current;
    transport.abortController.signal.addEventListener("abort", () => {
      if (current === session) void disconnect(transport.abortController.signal.reason?.message || "再接続してください。");
    }, {once: true});
    target.querySelector("[value=left]").checked = true;
    const next = await current.profile(selectedSide());
    if (current !== session) return;
    render(next);
    status.textContent = currentStatus();
  } catch (error) {
    if (opening !== generation) return;
    await disconnect(error.name === "NotFoundError" ? "接続先を確認してください。無線の場合はキーボード名を選びます。" : error.message);
  } finally {
    if (opening === generation) {
      busy = false;
      updateControls();
    }
  }
}
demo.addEventListener("click", () => {
  if (busy) return;
  if (session?.restart) {
    session = undefined;
    drafts.clear();
    render(undefined);
    status.textContent = initialStatus;
    return;
  }
  if (session) return;
  link = "デモ";
  session = demoSession();
  target.querySelector("[value=left]").checked = true;
  render(session.profile(selectedSide()));
  status.textContent = currentStatus();
});
restart.addEventListener("click", () => {
  if (busy || !session?.restart) return;
  session.restart(selectedSide());
  void readTarget();
});
connection.addEventListener("click", () => connect("USB"));
wireless.addEventListener("click", () => connect("無線"));

async function readTarget() {
  if (busy || !session) return;
  const current = session;
  busy = true;
  render(undefined);
  try {
    const next = await current.profile(selectedSide());
    if (current !== session) return;
    render(next);
    status.textContent = currentStatus();
  } catch (error) {
    if (current === session) status.textContent = error.message;
  } finally {
    if (current === session) {
      busy = false;
      updateControls();
    }
  }
}
target.addEventListener("change", readTarget);
reload.addEventListener("click", readTarget);

form.addEventListener("change", ({target: input}) => {
  if (!state || !input.matches("input[type=radio]")) return;
  const slot = input.closest(".slot").id;
  const draft = drafts.get(state.side) ?? {};
  if (input.value === state[slot]) delete draft[slot];
  else draft[slot] = input.value;
  drafts.set(state.side, draft);
  updateControls();
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!session || busy || save.disabled) return;
  busy = true;
  updateControls();
  const current = session;
  try {
    const next = await current.profile(selectedSide(), state.innerEnabled ? [form.elements.namedItem("lowerMode").value, form.elements.namedItem("innerMode").value] : [form.elements.namedItem("lowerMode").value]);
    if (current !== session) return;
    drafts.delete(next.side);
    render(next);
    status.textContent = currentStatus();
  } catch (error) {
    if (current === session) status.textContent = error.message;
  } finally {
    if (current === session) {
      busy = false;
      updateControls();
    }
  }
});

navigator.serial?.addEventListener("disconnect", (event) => {
  if (event.target === port) void disconnect("USB 接続が切れました。設定を確認するには再接続してください。");
});
if (!navigator.serial && !wirelessAdapter()) status.textContent = "USB または無線接続に対応した Chrome または Edge で開いてください。";
render(undefined);
