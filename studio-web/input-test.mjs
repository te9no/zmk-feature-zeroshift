const dialog = document.querySelector("#input-test");
const area = document.querySelector("#test-area");
const key = document.querySelector("#test-key");
const motion = document.querySelector("#test-motion");
const button = document.querySelector("#test-button");
const wheel = document.querySelector("#test-wheel");
const buttons = ["左", "中", "右", "戻る", "進む"];

document.querySelector("#test").addEventListener("click", () => {
  for (const output of area.querySelectorAll("output")) output.textContent = "—";
  dialog.showModal();
  area.focus();
});

for (const type of ["keydown", "keyup"]) {
  area.addEventListener(type, event => {
    if (event.key === "Escape" || event.key === "Tab") return;
    event.preventDefault();
    key.textContent = (event.code || event.key) + (type === "keydown" ? " 押下" : " 解放");
  });
}

area.addEventListener("pointermove", event => {
  motion.textContent = `X ${event.movementX} / Y ${event.movementY}`;
});
for (const type of ["pointerdown", "pointerup"]) {
  area.addEventListener(type, event => {
    button.textContent = (buttons[event.button] ?? event.button) +
      (type === "pointerdown" ? " 押下" : " 解放");
  });
}
area.addEventListener("contextmenu", event => event.preventDefault());
area.addEventListener("wheel", event => {
  event.preventDefault();
  wheel.textContent = `X ${event.deltaX} / Y ${event.deltaY}`;
}, {passive: false});
