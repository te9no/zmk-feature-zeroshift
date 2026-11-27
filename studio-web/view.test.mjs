import assert from "node:assert/strict";
import test from "node:test";
import {centralSide, iconFor, modeLabel, needsRestart, slotsOf, splitName} from "./view.mjs";

const ids = slot => slot.modes.map(mode => mode.id);

test("described slots split the part name out and pick an icon from the module kind", () => {
  const [input, display] = slotsOf({model: "Polaris", side: "left", central: "left", slots: [
    {label: "入力モジュール", saved: 3, active: 0,
      modes: [[0, "オフ"], [3, "トラックボール（PMW3610）"], [8, "光学エンコーダ（PAT9125）"], [6, "トラックパッド（IQS9151）"], [7, "1u キー"]]},
    {label: "左手の表示モジュール", saved: 0, active: 0, modes: [[0, "標準（OLED／停止中）"], [1, "四連 LED（左 Cirque と排他）"]]},
  ]});
  assert.deepEqual(input.modes.map(mode => [mode.name, mode.detail, mode.icon]), [
    ["オフ", undefined, "off"], ["トラックボール", "PMW3610", "pmw3610"], ["光学エンコーダ", "PAT9125", "pat9125"],
    ["トラックパッド", "IQS9151", "tpd"], ["1u キー", undefined, "key"]]);
  assert.equal(modeLabel(input.activeMode), "オフ");
  assert.deepEqual(display.modes.map(mode => mode.icon), ["module", "module"]);
  assert.equal(needsRestart([input, display]), true);
  assert.equal(needsRestart([display]), false);
});

test("unknown module names fall back to the generic icon", () => {
  assert.equal(iconFor(42, "温度センサー"), "module");
  assert.deepEqual(splitName("Cirque タッチパッド"), ["Cirque タッチパッド"]);
  assert.deepEqual(splitName("LPPS (ADS1220)"), ["LPPS", "ADS1220"]);
});

test("firmware without a capability list offers base modes and keeps the stored one", () => {
  const state = {side: "right", lower: "off", inner: "pat9125", activeLower: "off", activeInner: "off", innerEnabled: true};
  const [lower, inner] = slotsOf(state);
  assert.deepEqual(ids(lower), ["off", "pmw3610", "encoder", "stick", "key"]);
  assert.deepEqual(ids(inner), ["off", "pmw3610", "lpps", "encoder", "pat9125", "key"]);
  assert.deepEqual([lower.label, lower.connector, inner.label, inner.connector], ["下側", "J7", "中央側", "J8"]);
  assert.deepEqual(ids(slotsOf(state, {demo: true})[0]), ["off", "pmw3610", "encoder", "pat9125", "lpps", "stick", "key"]);
  assert.equal(centralSide(state), "left");
});

test("a capability list decides the choices, and Ananta and MeKaBu name their sockets", () => {
  const ananta = slotsOf({model: "Ananta", side: "left", lower: "tpd", inner: "off", activeLower: "iqs", activeInner: "off",
    innerEnabled: true, supported: {lower: ["off", "iqs"], inner: ["off"]}});
  assert.deepEqual(ids(ananta[0]), ["off", "iqs", "tpd"]);
  assert.equal(ananta[0].modes[1].icon, "tpd");
  assert.equal(modeLabel(ananta[0].activeMode), "トラックパッド（IQS9151）");
  assert.deepEqual(ananta.map(slot => [slot.label, slot.connector]), [["下側", ""], ["上部", ""]]);
  assert.equal(centralSide({model: "Ananta"}), "right");
  assert.equal(centralSide({model: "Polaris", central: "right"}), "right");

  const upper = slotsOf({model: "Ananta", side: "right", lower: "off", inner: "stick", activeLower: "off", activeInner: "stick",
    innerEnabled: true, supported: {lower: ["off"], inner: ["off", "stick", "rzt"]}})[1];
  assert.deepEqual(ids(upper), ["off", "stick", "rzt"]);

  const mekabu = slotsOf({model: "MeKaBu", side: "left", lower: "rzt", activeLower: "rzt", innerEnabled: false,
    supported: {lower: ["off", "rzt", "lpps"]}});
  assert.equal(mekabu.length, 1);
  assert.deepEqual([mekabu[0].label, mekabu[0].connector, ids(mekabu[0])], ["拡張ソケット", "", ["off", "lpps", "rzt"]]);
});
