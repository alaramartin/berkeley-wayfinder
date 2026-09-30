/** Turning wheel and pinch events into a zoom amount. */

/** Lines and pages are not pixels; browsers report a mouse wheel in whichever the OS uses. */
const PIXELS_PER_LINE = 16;
const PIXELS_PER_PAGE = 100;
/** A single event is never allowed to move further than this, so a fast flick cannot fling the camera. */
const MAX_DELTA = 120;
/** Zoom per pixel of scroll. A pinch is reported in much smaller steps than a wheel notch. */
const WHEEL_RATE = 0.0012;
const PINCH_RATE = 0.005;

/**
 * How much one wheel or pinch event should scale the distance to the scene: below 1 zooms in.
 *
 * Proportional to the scroll amount, so a notch of a mouse wheel is a clear step (about 13%), a slow
 * pinch is gentle and a fast one is fast. The stock controls applied a fixed percentage per event and
 * ignored the amount entirely.
 */
export function zoomFactor(e: { deltaY: number; deltaMode: number; ctrlKey: boolean }): number {
  const unit = e.deltaMode === 1 ? PIXELS_PER_LINE : e.deltaMode === 2 ? PIXELS_PER_PAGE : 1;
  const pixels = Math.min(MAX_DELTA, Math.max(-MAX_DELTA, e.deltaY * unit));
  // Scrolling up (negative deltaY) zooms in.
  return Math.exp(pixels * (e.ctrlKey ? PINCH_RATE : WHEEL_RATE));
}
