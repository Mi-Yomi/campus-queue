const base = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
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
let visitorToken = storage.get("campus.visitor.v1");
if (!visitorToken) {
  visitorToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  storage.set("campus.visitor.v1", visitorToken);
}
export const visitorStorageAvailable = () =>
  storage.set("campus.visitor.v1", visitorToken) &&
  storage.get("campus.visitor.v1") === visitorToken;
export async function request(
  path,
  { method = "GET", body, admin = false, signal, displayToken } = {},
) {
  if (
    (path.endsWith("/join") || path.endsWith("/redeem")) &&
    !visitorStorageAvailable()
  )
    throw new Error(
      "Браузер не разрешает сохранить талон. Разрешите хранение данных сайта и повторите запись.",
    );
  const headers = { "X-Visitor-Token": visitorToken };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (displayToken) headers["X-Display-Token"] = displayToken;
  if (admin)
    headers.Authorization = `Bearer ${storage.get("campus.admin.v1", true) || ""}`;
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
    throw new Error("Нет связи с сервером. Проверьте подключение.");
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
  return result;
}
