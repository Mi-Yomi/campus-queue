import { readVisitor, visitorCookie } from "./visitor-identity.mjs";

export const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
export const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
export const cloudEnabled = !!(supabaseUrl && publishableKey);
const base = cloudEnabled
  ? `${supabaseUrl}/functions/v1/queue-api`
  : (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
export const storage = {
  get(key, session = false) {
    try {
      return (session ? sessionStorage : localStorage).getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value, session = false) {
    try {
      const store = session ? sessionStorage : localStorage;
      value ? store.setItem(key, value) : store.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },
};
let cookieBackup = "";
try { cookieBackup = document.cookie; } catch { /* private browser storage may be blocked */ }
let visitorToken = readVisitor(storage, cookieBackup);
if (!visitorToken) {
  visitorToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  storage.set("campus.visitor.v1", visitorToken);
}
// Safari 17.2+ copies first-party cookies into a newly installed Home Screen app.
// Keep the existing identity; never put a visitor capability in a URL/manifest.
storage.set("campus.visitor.v1", visitorToken);
try { document.cookie = visitorCookie(visitorToken, location.href); } catch { /* manual transfer remains available */ }
export function restoreVisitor(token) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token) || !storage.set("campus.visitor.v1", token))
    throw new Error("Разрешите хранение данных сайта и повторите перенос.");
  visitorToken = token;
  try { document.cookie = visitorCookie(token, location.href); } catch { /* localStorage is sufficient here */ }
}
export const visitorStorageAvailable = () =>
  storage.set("campus.visitor.v1", visitorToken) &&
  storage.get("campus.visitor.v1") === visitorToken;
export async function request(
  path,
  { method = "GET", body, admin = false, signal, displayToken } = {},
) {
  if (
    (path.endsWith("/join") || path.endsWith("/redeem") || path.endsWith("/retake")) &&
    !visitorStorageAvailable()
  )
    throw new Error(
      "Браузер не разрешает сохранить талон. Разрешите хранение данных сайта и повторите запись.",
    );
  const headers = { "X-Visitor-Token": visitorToken };
  if (cloudEnabled) headers.apikey = publishableKey;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (displayToken) headers["X-Display-Token"] = displayToken;
  if (admin) {
    const token = storage.get("campus.admin.v1", true) || "";
    if (cloudEnabled) headers["X-Queue-Session"] = token;
    else headers.Authorization = `Bearer ${token}`;
  }
  let response;
  try {
    response = await fetch(`${base}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw Object.assign(new Error("Нет связи с сервером. Проверьте подключение."), { isConnectionError: true });
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Сервер недоступен или адрес API настроен неверно.");
  }
  if (!response.ok) {
    const error = new Error(result.error || "Не удалось выполнить действие.");
    error.status = response.status;
    throw error;
  }
  if (method !== "GET" && cloudEnabled)
    storage.set("campus.changed.v1", `${Date.now()}:${path}`);
  return result;
}
