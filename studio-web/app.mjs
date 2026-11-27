import { moduleSession } from "./rpc.mjs";
import { openWireless, wirelessAdapter } from "./wireless.mjs";
import {usbConnection} from "./usb.mjs";
import {centralSide, modeLabel, needsRestart, slotsOf} from "./view.mjs";
const query = new URLSearchParams(location.search);
const usb = usbConnection(navigator, query.get("usb") === "device");
const wireless = document.querySelector("#wireless");
const wirelessName = document.querySelector("#wireless-name");
wirelessName.value = query.get("name") ?? "";
const target = document.querySelector("#target");
const selectedSide = () => target.querySelector(":checked").value;
const reload = document.querySelector("#reload");

const connection = document.querySelector("#connection");
const side = document.querySelector("#side");
const status = document.querySelector("#status");
const form = document.querySelector("#modules");
const slotList = document.querySelector("#slots");
const save = document.querySelector("#save");
const discard = document.querySelector("#discard");
const pending = document.querySelector("#pending");
const demo = document.querySelector("#demo");
const restart = document.querySelector("#restart");
const initialStatus = status.textContent;
const sideName = value => value === "left" ? "左側" : "右側";

function setStatus(text, tone = "info") {
  status.textContent = text;
  status.dataset.tone = tone;
}

// ?demo=described previews a keyboard that describes its own slots.
function demoSession() {
  const input = ["オフ", "トラックボール（PMW3610）", "アナログスティック", "エンコーダ", "Cirque タッチパッド",
    "LPPS（ADS1220）", "トラックパッド（IQS9151）", "1u キー", "光学エンコーダ（PAT9125）"].map((name, id) => [id, name]);
  const described = query.get("demo") === "described" && {
    left: [{label: "入力モジュール", modes: input}, {label: "表示モジュール", modes: [[0, "標準（OLED）"], [1, "四連 LED"]]}],
    right: [{label: "入力モジュール", modes: input.filter(([id]) => id !== 2)}],
  };
  const profiles = {};
  for (const side of ["left", "right"]) {
    profiles[side] = described
      ? {model: "Polaris", side, central: "left", slots: described[side].map(slot => ({...slot, saved: 0, active: 0}))}
      : {side, lower: "off", inner: "off", activeLower: "off", activeInner: "off", innerEnabled: true, allModules: true};
  }
  return {
    profile(side, modes) {
      const profile = profiles[side];
      if (modes && described) profile.slots.forEach((slot, i) => slot.saved = modes[i]);
      else if (modes) [profile.lower, profile.inner] = modes;
      return {...profile, slots: profile.slots?.map(slot => ({...slot}))};
    },
    restart(side) {
      const profile = profiles[side];
      profile.slots?.forEach(slot => slot.active = slot.saved);
      profile.activeLower = profile.lower;
      profile.activeInner = profile.inner;
    },
  };
}

let link;
let port;
let session;
let state;
let view = [];
let busy = false;
let generation = 0;
const drafts = new Map();

function selections() {
  return view.map((slot, i) => {
    const checked = slotList.querySelector(`input[name="slot-${i}"]:checked`);
    return checked ? slot.modes[Number(checked.value)].id : slot.saved;
  });
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderSlots() {
  const draft = drafts.get(state.side);
  slotList.replaceChildren(...view.map((slot, index) => {
    const group = element("fieldset", "slot");
    const legend = element("legend");
    legend.append(element("b", "", slot.label));
    if (slot.connector) legend.append(element("span", "connector", slot.connector));
    const running = element("p", "running", "起動中：");
    running.append(element("b", "", modeLabel(slot.activeMode)));
    const waiting = slot.saved !== slot.active && slot.modes.find(mode => mode.id === slot.saved);
    const choices = element("div", "choices");
    slot.modes.forEach((mode, choice) => {
      const option = element("label");
      const radio = element("input");
      radio.type = "radio";
      radio.name = "slot-" + index;
      radio.value = choice;
      radio.checked = mode.id === (draft?.[index] ?? slot.saved);
      const card = element("span", "card");
      const icon = element("img", "module-icon");
      icon.src = "icons/" + mode.icon + (mode.icon === "module" ? ".svg" : ".png");
      icon.width = icon.height = 32;
      icon.alt = "";
      card.append(icon, element("span", "name", mode.name));
      if (mode.detail) card.append(element("small", "", mode.detail));
      if (mode.id === slot.active) card.append(element("em", "badge running-badge", "起動中"));
      else if (mode === waiting) card.append(element("em", "badge", "リセット後に有効"));
      option.append(radio, card);
      choices.append(option);
    });
    group.append(legend, running, choices);
    return group;
  }));
}

function renderPending() {
  pending.hidden = !needsRestart(view);
  if (pending.hidden) return;
  const name = sideName(state.side);
  const inDemo = !!session?.restart;
  document.querySelector("#pending-title").textContent = name + "のリセットで切り替わります";
  document.querySelector("#pending-steps").textContent = inDemo
    ? "「デモで再起動」を押すと、保存したモジュールで起動した状態になります。"
    : state.side === centralSide(state)
      ? name + "は親機なので、リセットすると接続が切れます。起動したらもう一度接続し、保存したモジュールが「起動中」になったことを確認してください。"
      : name + "をリセットし、左右がつながってから「再読込」を押して、保存したモジュールが「起動中」になったことを確認してください。";
  restart.hidden = !inDemo;
}

function updateControls() {
  const inDemo = !!session?.restart;
  const edited = !!state && drafts.has(state.side);
  document.querySelector(".connect").toggleAttribute("data-compact", !!session);
  document.querySelector("#target-bar").hidden = !session;
  document.querySelector("#help").hidden = !!session;
  side.dataset.connected = String(!!state);
  target.disabled = reload.disabled = busy;
  for (const input of target.querySelectorAll("input")) input.nextElementSibling.querySelector("em").hidden = !drafts.has(input.value);
  demo.hidden = !!session && !inDemo;
  demo.disabled = restart.disabled = busy;
  demo.textContent = inDemo ? "デモを終了" : "デモモード";
  connection.hidden = !!session && link !== "USB";
  wirelessName.parentElement.hidden = !!session || !wirelessAdapter();
  wirelessName.disabled = busy;
  wireless.hidden = !!session && link !== "無線";
  wireless.disabled = busy || !wirelessAdapter();
  wireless.textContent = session ? "無線切断" : "無線接続";
  connection.disabled = busy || !usb.requestPort;
  connection.textContent = session ? "USB 切断" : usb.kind === "device" ? "USB デバイスを選択" : "USB 接続";
  document.querySelector("#support").hidden = !!session || !document.querySelector("#support").textContent;
  form.setAttribute("aria-busy", String(busy));
  for (const group of slotList.children) group.disabled = busy;
  save.disabled = busy || !edited;
  discard.hidden = !edited;
  discard.disabled = busy;
  document.querySelector("#edit-state").textContent = edited ? "未保存の変更があります" : "";
}

function render(next) {
  state = next;
  form.hidden = !state;
  if (!state) {
    view = [];
    side.textContent = session ? link + " 接続中" : "未接続";
    updateControls();
    return;
  }
  view = slotsOf(state, {demo: !!session?.restart});
  side.textContent = (state.model || "CaGiMe") + " · " + link;
  renderSlots();
  renderPending();
  updateControls();
}

function currentStatus() {
  if (needsRestart(view)) return "保存した設定は、" + sideName(state.side) + "をリセットすると有効になります。";
  if (session?.restart) return "デモの設定はこの画面内で有効です。デモを終了すると初期状態に戻ります。";
  return sideName(state.side) + "の設定を本体から読み取りました。";
}

async function disconnect(message, interrupted = false, tone = interrupted ? "error" : "info") {
  const closing = ++generation;
  busy = true;
  drafts.clear();
  const previous = session;
  session = undefined;
  const oldPort = port;
  port = undefined;
  render(undefined);
  setStatus(message.replaceAll(new RegExp(["blue", "tooth"].join(""), "gi"), "無線"), tone);
  try {
    await previous?.close();
  } finally {
    if (oldPort) {
      if (interrupted && oldPort.interrupt) await oldPort.interrupt().catch(() => {});
      else {
        if (interrupted) void oldPort.writable?.abort().catch(() => {});
        await oldPort.close().catch(() => {});
      }
    }
    if (closing === generation) {
      busy = false;
      updateControls();
    }
  }
}

async function connect(kind) {
  if (busy) return;
  if (session) {
    await disconnect("切断しました。" + initialStatus);
    return;
  }
  const opening = ++generation;
  busy = true;
  updateControls();
  try {
    link = kind;
    let transport;
    if (kind === "無線") {
      transport = await openWireless(wirelessName.value);
    } else {
      const selected = await usb.requestPort();
      port = selected;
      await selected.open({baudRate: 115200});
      if (opening !== generation) return;
      await selected.setSignals({dataTerminalReady: true});
      if (opening !== generation) return;
      transport = {readable: port.readable, writable: port.writable, abortController: new AbortController()};
    }
    setStatus("本体の設定を読み取っています。");
    const current = moduleSession(transport);
    session = current;
    transport.abortController.signal.addEventListener("abort", () => {
      if (current === session) void disconnect(transport.abortController.signal.reason?.message || "再接続してください。", true);
    }, {once: true});
    const next = await current.profile();
    if (current !== session) return;
    target.querySelector(`[value="${next.side}"]`).checked = true;
    render(next);
    setStatus(currentStatus());
  } catch (error) {
    if (opening !== generation) return;
    // Closing the browser's device chooser is not a failure.
    if (error.name === "NotFoundError") await disconnect("接続先が選ばれませんでした。親機を選んでください。無線の場合はキーボード名を選びます。");
    else await disconnect(error.message, false, "error");
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
    setStatus(initialStatus);
    return;
  }
  if (session) return;
  link = "デモ";
  session = demoSession();
  target.querySelector("[value=left]").checked = true;
  render(session.profile(selectedSide()));
  setStatus(currentStatus());
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
  // Keep the previous cards in place, dimmed, so the page does not jump while reading.
  updateControls();
  setStatus(sideName(selectedSide()) + "の設定を読み取っています。");
  try {
    const next = await current.profile(selectedSide());
    if (current !== session) return;
    render(next);
    setStatus(currentStatus());
  } catch (error) {
    if (current !== session) return;
    render(undefined);
    setStatus(error.message, "error");
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
  const chosen = selections();
  if (chosen.every((id, i) => id === view[i].saved)) drafts.delete(state.side);
  else drafts.set(state.side, chosen);
  updateControls();
});
discard.addEventListener("click", () => {
  if (busy || !state) return;
  drafts.delete(state.side);
  render(state);
  save.focus();
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!session || busy || save.disabled) return;
  busy = true;
  updateControls();
  const current = session;
  try {
    const next = await current.profile(selectedSide(), selections());
    if (current !== session) return;
    drafts.delete(next.side);
    render(next);
    setStatus(needsRestart(view) ? "保存しました。" + currentStatus() : "保存しました。", "ok");
  } catch (error) {
    if (current === session) setStatus(error.message, "error");
  } finally {
    if (current === session) {
      busy = false;
      updateControls();
    }
  }
});
addEventListener("beforeunload", event => {
  if (drafts.size) event.preventDefault();
});

navigator.serial?.addEventListener("disconnect", (event) => {
  if (event.target === port) void disconnect("USB 接続が切れました。設定を確認するには再接続してください。", true);
});
document.querySelector("#support").textContent = !usb.requestPort && !wirelessAdapter()
  ? "このブラウザーは USB 接続にも無線接続にも対応していません。PC の Chrome または Edge で開いてください。Android ではリンクをコピーし、Chrome アプリで開きます。"
  : !usb.requestPort ? "このブラウザーでは USB デバイスを選択できません。Android ではリンクをコピーし、Chrome アプリで開いてください。"
  : !wirelessAdapter() ? "このブラウザーでは無線接続を使えません。USB で接続してください。" : "";
render(undefined);
