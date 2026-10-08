// Push endpoints are capabilities. Never fetch an arbitrary user-supplied URL.
export function validPushEndpoint(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.hash) return false;
    return (u.hostname === "fcm.googleapis.com" && u.pathname.startsWith("/fcm/send/")) ||
      (u.hostname === "updates.push.services.mozilla.com" && u.pathname.startsWith("/wpush/")) ||
      (u.hostname === "web.push.apple.com" && u.pathname.startsWith("/")) ||
      (/^([a-z0-9-]+\.)?notify\.windows\.com$/.test(u.hostname) && u.pathname.startsWith("/w/"));
  } catch { return false; }
}

export async function validateSubscription(value) {
  if (!value || !validPushEndpoint(value.endpoint)) throw new Error("Этот сервис уведомлений пока не поддерживается. Откройте РИТМ в Safari, Chrome, Firefox или Edge.");
  const { p256dh, auth } = value.keys || {};
  const decode = (v, size) => {
    if (typeof v !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(v) || v.length > 100) throw new Error("Некорректная подписка.");
    const bytes = Uint8Array.from(atob(v.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    if (bytes.length !== size) throw new Error("Некорректная подписка.");
    return bytes;
  };
  decode(auth, 16);
  await crypto.subtle.importKey("raw", decode(p256dh, 65), { name: "ECDH", namedCurve: "P-256" }, false, []);
  return { endpoint: value.endpoint, keys: { p256dh, auth } };
}

export function deliveryResult(status) {
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "gone";
  if (status === 429 || status >= 500 || status === 0) return "retry";
  return "failed";
}
