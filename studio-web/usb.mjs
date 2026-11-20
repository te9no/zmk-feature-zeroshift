import {SerialPort} from "web-serial-polyfill";

const vendorId = 0x1d50;
const productId = 0x615e;

export function usbConnection(browser, forceDevice = false) {
  const android = browser.userAgentData?.platform === "Android" || /Android/i.test(browser.userAgent);
  if (forceDevice || android || !browser.serial) {
    if (!browser.usb?.requestDevice) return {kind: "device"};
    return {
      kind: "device",
      async requestPort() {
        // ZMK exposes CDC alongside HID in a composite USB device.
        const device = await browser.usb.requestDevice({filters: [{vendorId, productId}]});
        return new SerialPort(device);
      },
    };
  }
  return {
    kind: "serial",
    requestPort: () => browser.serial.requestPort({filters: [{usbVendorId: vendorId, usbProductId: productId}]}),
  };
}
