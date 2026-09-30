/**
 * Telling a trackpad swipe from a mouse wheel.
 *
 * Both arrive as `wheel`. A two-finger swipe should slide the model and a mouse wheel should zoom, so
 * the two have to be told apart — and getting it wrong in the unsafe direction would leave a mouse
 * user with no way to zoom at all. So: assume mouse (zoom) until a trackpad gives itself away, then
 * latch. Pinch is unambiguous — macOS sends it as a wheel with ctrlKey — and always zooms.
 */
export type WheelIntent = { kind: "zoom"; amount: number } | { kind: "pan"; dx: number; dy: number };

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  timeStamp: number;
}

export type PointerDevice = "auto" | "mouse" | "trackpad";

export interface WheelRouter {
  route(event: WheelLike): WheelIntent;
  device(): "mouse" | "trackpad" | "unknown";
}

const isInteger = (value: number) => Number.isInteger(value);

export function createWheelRouter(device: PointerDevice = "auto"): WheelRouter {
  let latched: "mouse" | "trackpad" | "unknown" = device === "auto" ? "unknown" : device;
  let fineEvents = 0;
  let fineSince = 0;

  const looksLikeTrackpad = (e: WheelLike): boolean => {
    // Mice send whole numbers, in lines or in coarse pixel steps, and no sideways delta unless the
    // user is holding shift.
    if (!isInteger(e.deltaY) || !isInteger(e.deltaX)) return true;
    if (e.deltaX !== 0 && !e.shiftKey) return true;
    if (e.deltaMode === 0 && Math.abs(e.deltaY) < 10 && e.deltaY !== 0) {
      if (e.timeStamp - fineSince > 120) {
        fineEvents = 0;
        fineSince = e.timeStamp;
      }
      fineEvents += 1;
      if (fineEvents >= 3) return true;
    }
    return false;
  };

  return {
    device: () => latched,
    route(e: WheelLike): WheelIntent {
      // Pinch and the explicit modifiers always zoom, on every device.
      if (e.ctrlKey || e.metaKey) return { kind: "zoom", amount: e.deltaY };
      if (device === "auto" && latched !== "trackpad" && looksLikeTrackpad(e)) latched = "trackpad";
      if (device === "trackpad" || latched === "trackpad") return { kind: "pan", dx: e.deltaX, dy: e.deltaY };
      return { kind: "zoom", amount: e.deltaY };
    },
  };
}
