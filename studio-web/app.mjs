import { moduleSession } from "./rpc.mjs";
import { openBluetooth } from "./bluetooth.mjs";
const bluetooth = document.querySelector("#bluetooth");
const target = document.querySelector("#target");
const reload = document.querySelector("#reload");

const connection = document.querySelector("#connection");
const side = document.querySelector("#side");
const status = document.querySelector("#status");
const form = document.querySelector("#modules");
const lower = document.querySelector("#lower");
const inner = document.querySelector("#inner");
const save = document.querySelector("#save");
const mode = {
  off: "オフ",
  pmw3610: "トラックボール（PMW3610）",
  lpps: "LPPS（ADS1220）",
  encoder: "エンコーダ",
  stick: "アナログスティック",
  key: "1uキー",
};
let link;
let port;
let session;
let state;
let busy = false;

function updateControls() {
  document.querySelector("#target-bar").hidden = !session;
  target.disabled = reload.disabled = busy;
  connection.hidden = !!session && link === "Bluetooth";
  bluetooth.hidden = !!session && link === "USB";
  bluetooth.disabled = busy || !navigator.bluetooth;
  bluetooth.textContent = session ? "Bluetooth 切断" : "Bluetooth 接続";
  connection.disabled = busy || !navigator.serial;
  connection.textContent = session ? "USB 切断" : "USB 接続";
  lower.disabled = busy;
  inner.disabled = busy || !state?.innerEnabled;
  save.disabled = busy || !state || (lower.value === state.lower && inner.value === state.inner);
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
  side.textContent = left ? "左側の設定" : "右側の設定";
  document.querySelector("#lower-connector").textContent = left ? "J4" : "J7";
  document.querySelector("#inner-connector").textContent = left ? "J5" : "J8";
  for (const option of form.querySelectorAll("[data-all-modules]")) {
    option.hidden = option.disabled = !state.allModules;
  }
  lower.value = state.lower;
  inner.value = state.inner;
  document.querySelector("#lower-state").textContent = "起動時のドライバー " + mode[state.activeLower];
  document.querySelector("#inner-state").textContent = state.innerEnabled
    ? "起動時のドライバー " + mode[state.activeInner]
    : "このファームウェアでは中央側を設定できません。";
  updateControls();
}

function currentStatus() {
  if (state.lower !== state.activeLower || state.inner !== state.activeInner) {
    return "保存済みの設定を反映するには、設定した側をリセットして、再読込してください。左側をリセットした場合は 再接続してください。";
  }
  return "本体から設定を読み取りました。";
}

async function disconnect(message) {
  const previous = session;
  session = undefined;
  const oldPort = port;
  port = undefined;
  await previous?.close();
  if (oldPort?.readable) await oldPort.close().catch(() => {});
  render(undefined);
  status.textContent = message;
}

async function connect(kind) {
  busy = true;
  updateControls();
  try {
    if (session) {
      await disconnect("左側を USB または Bluetooth で接続してください。");
      return;
    }
    link = kind;
    let transport;
    if (kind === "Bluetooth") {
      transport = await openBluetooth();
    } else {
      port = await navigator.serial.requestPort({filters: [{usbVendorId: 0x1d50, usbProductId: 0x615e}]});
      await port.open({baudRate: 115200});
      await port.setSignals({dataTerminalReady: true});
      transport = {readable: port.readable, writable: port.writable, abortController: new AbortController()};
    }
    status.textContent = "本体の設定を読み取っています。";
    const current = moduleSession(transport);
    session = current;
    transport.abortController.signal.addEventListener("abort", () => {
      if (current === session) void disconnect(transport.abortController.signal.reason?.message || "再接続してください。");
    }, {once: true});
    target.value = "left";
    render(await session.profile(target.value));
    status.textContent = currentStatus();
  } catch (error) {
    await disconnect(error.name === "NotFoundError" ? "接続先を確認してください。Bluetooth の場合は CaGiMe を選びます。" : error.message);
  } finally {
    busy = false;
    updateControls();
  }
}
connection.addEventListener("click", () => connect("USB"));
bluetooth.addEventListener("click", () => connect("Bluetooth"));

async function readTarget() {
  if (busy || !session) return;
  busy = true;
  render(undefined);
  try {
    render(await session.profile(target.value));
    status.textContent = currentStatus();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    busy = false;
    updateControls();
  }
}
target.addEventListener("change", readTarget);
reload.addEventListener("click", readTarget);

form.addEventListener("change", updateControls);
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!session || busy || save.disabled) return;
  busy = true;
  updateControls();
  const current = session;
  try {
    const next = await current.profile(target.value, [lower.value, inner.value]);
    if (current !== session) return;
    render(next);
    status.textContent = currentStatus();
  } catch (error) {
    if (current === session) status.textContent = error.message;
  } finally {
    busy = false;
    updateControls();
  }
});

navigator.serial?.addEventListener("disconnect", (event) => {
  if (event.target === port) void disconnect("USB 接続が切れました。設定を確認するには再接続してください。");
});
if (!navigator.serial && !navigator.bluetooth) status.textContent = "Chrome または Edge でこのページを localhost から開いてください。";
render(undefined);
