import {serial as webUsbSerial} from "web-serial-polyfill";

// Some Android browsers expose a serial picker without listing wired CDC devices.
export function usbSerial(browser) {
  const android = browser.userAgentData?.platform === "Android" || /Android/i.test(browser.userAgent);
  if (browser.usb && (android || !browser.serial)) return webUsbSerial;
  return browser.serial;
}
