import { FIELD_ENABLED } from "@/lib/field/gate";

export const dynamic = "force-static";

/** The offline worker for /field. Served only in field builds. */
const WORKER = `
const CACHE = "wf-field-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.add("/field").catch(() => {})));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("wf-field-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page tells us what it has already loaded, so the first visit is complete without a reload.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "precache") {
    event.waitUntil(caches.open(CACHE).then((c) => Promise.all(event.data.urls.map((u) => c.add(u).catch(() => {})))));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (e) {
    const hit = (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true }));
    if (hit) return hit;
    if (request.mode === "navigate") { const page = await cache.match("/field"); if (page) return page; }
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) return event.respondWith(cacheFirst(request));
  if (url.pathname.startsWith("/field") || url.pathname.startsWith("/data/")) return event.respondWith(networkFirst(request));
});
`;

export function GET() {
  if (!FIELD_ENABLED) return new Response("Not found", { status: 404 });
  return new Response(WORKER, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache",
      "service-worker-allowed": "/",
    },
  });
}
