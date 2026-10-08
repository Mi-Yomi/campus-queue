/* Push only. Deliberately no fetch handler or application/data cache. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* show a safe fallback */ }
  const current = Number(data.expiresAt) > Date.now();
  const queueId = typeof data.queueId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(data.queueId) ? data.queueId : null;
  const target = new URL(queueId ? `./#/q/${encodeURIComponent(queueId)}` : "./#/", self.registration.scope).href;
  event.waitUntil(self.registration.showNotification(current ? "РИТМ — ваша очередь!" : "РИТМ — проверьте талон", {
    body: current && typeof data.body === "string" ? data.body.slice(0, 200) : "Статус вашей очереди обновился. Откройте талон.",
    icon: new URL("brand/ritm-app-192.png", self.registration.scope).href,
    badge: new URL("brand/ritm-favicon.png", self.registration.scope).href,
    tag: typeof data.tag === "string" ? data.tag.slice(0, 100) : "ritm-call",
    data: { url: target }, renotify: false,
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const scope = new URL(self.registration.scope);
    let target = new URL(event.notification.data?.url || scope.href, scope);
    if (target.origin !== scope.origin || !target.pathname.startsWith(scope.pathname)) target = scope;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => {
      const u = new URL(client.url);
      return u.origin === scope.origin && u.pathname.startsWith(scope.pathname);
    });
    if (existing) {
      const navigated = await existing.navigate(target.href);
      if (navigated) return navigated.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
