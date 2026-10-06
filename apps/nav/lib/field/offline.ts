/**
 * Making /field work with no signal.
 *
 * A service worker keeps the page, its scripts and the building data. It can only be registered over
 * https (or localhost), which is why the walk is done from a private https deployment and not from the
 * laptop's address on Wi-Fi. Edits do not depend on it: they are in IndexedDB either way.
 */
export type OfflineState = "starting" | "ready" | "unsupported" | "failed";

export function registerOffline(report: (state: OfflineState) => void): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) {
    report("unsupported");
    return;
  }
  navigator.serviceWorker
    .register("/field-sw.js", { scope: "/field" })
    .then(() => navigator.serviceWorker.ready)
    .then((registration) => {
      // The scripts and data this page already loaded may predate the worker, so hand it the list.
      const urls = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((u) => new URL(u).origin === location.origin);
      registration.active?.postMessage({ type: "precache", urls: [location.pathname + location.search, ...urls] });
      report("ready");
    })
    .catch(() => report("failed"));
}
