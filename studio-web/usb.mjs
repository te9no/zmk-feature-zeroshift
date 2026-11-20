import {SerialPort} from "web-serial-polyfill";

const vendorId = 0x1d50;
const productId = 0x615e;

class StudioUsbPort extends SerialPort {
  constructor(device) {
    super(device);
    this.device = device;
    const dataInterface = device.configurations[0].interfaces.find(
      iface => iface.alternates[0].interfaceClass === 10);
    this.input = dataInterface.alternates[0].endpoints.find(endpoint => endpoint.direction === "in");
  }

  get readable() {
    if (!this.device.opened) return null;
    if (!this.inputStream) {
      let cancelled = false;
      this.inputStream = new ReadableStream({
        pull: async controller => {
          while (!cancelled) {
            const {status, data} = await this.device.transferIn(this.input.endpointNumber, this.input.packetSize);
            if (cancelled) return;
            if (status !== "ok") throw new Error(`USB read failed (${status})`);
            // CDC may send an empty packet before the first Studio frame.
            if (!data?.byteLength) continue;
            controller.enqueue(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            return;
          }
        },
        cancel() { cancelled = true; },
      }, {highWaterMark: 0});
    }
    return this.inputStream;
  }

  async close() {
    try {
      await this.inputStream?.cancel().catch(() => {});
    } finally {
      this.inputStream = null;
      await super.close();
    }
  }
}

export function usbConnection(browser, forceDevice = false) {
  const android = browser.userAgentData?.platform === "Android" || /Android/i.test(browser.userAgent);
  if (forceDevice || android || !browser.serial) {
    if (!browser.usb?.requestDevice) return {kind: "device"};
    return {
      kind: "device",
      async requestPort() {
        // ZMK exposes CDC alongside HID in a composite USB device.
        const device = await browser.usb.requestDevice({filters: [{vendorId, productId}]});
        return new StudioUsbPort(device);
      },
    };
  }
  return {
    kind: "serial",
    requestPort: () => browser.serial.requestPort({filters: [{usbVendorId: vendorId, usbProductId: productId}]}),
  };
}
