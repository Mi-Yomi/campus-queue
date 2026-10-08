import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const allowedOrigins = new Set([
  "https://mi-yomi.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function rpc(name: string, args: Record<string, unknown>) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(args), signal: AbortSignal.timeout(12000),
  });
  const result = await response.json();
  if (!response.ok) {
    const status = /^PT[345]\d\d$/.test(result.code) ? Number(result.code.slice(2)) : result.code === "23505" ? 409 : 500;
    throw new ApiError(status, status < 500 ? result.message : "Не удалось выполнить действие. Попробуйте ещё раз.");
  }
  return result;
}
function text(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new ApiError(400, `${label}: от 1 до ${max} символов.`);
  return value.trim();
}
function integer(value: unknown, min: number, max: number, label: string) {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new ApiError(400, `${label}: число от ${min} до ${max}.`);
  return value;
}
function fields(body: Record<string, unknown>, names: string[]) {
  if (Object.keys(body).some(key => !names.includes(key))) throw new ApiError(400, "Неизвестное поле.");
}
function passwordFields() {
  const password = randomBytes(12).toString("base64url"), salt = randomBytes(16).toString("hex");
  return { _password: password, _hash: `${salt}:${scryptSync(password, salt, 64).toString("hex")}` };
}
function validPassword(password: string, hash: string | null) {
  // Equal-cost fallback avoids leaking whether the username exists.
  const encoded = /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash ?? "") ? hash! : `${"0".repeat(32)}:${"0".repeat(128)}`;
  const [salt, expected] = encoded.split(":");
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(expected, "hex")) && !!hash;
}

// The platform JWT gate is disabled because this application uses its existing
// opaque teacher/display sessions and browser capabilities. Every private route
// is authenticated and authorized again inside campus_api. Browser roles cannot
// invoke that RPC or read any private table; the service key never leaves here.
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin" });
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "Content-Type, apikey, Authorization, X-Visitor-Token, X-Queue-Session, X-Display-Token, x-client-info");
    headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
    headers.set("Access-Control-Max-Age", "86400");
  }
  const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
  try {
    if (origin && !allowedOrigins.has(origin)) throw new ApiError(403, "Этот адрес сайта не разрешён в настройках API.");
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const requestUrl = new URL(req.url);
    const path = requestUrl.pathname.replace(/^.*\/queue-api/, "").replace(/^\/api(?=\/|$)/, "") || "/";
    if (requestUrl.search || !["GET", "POST", "PATCH"].includes(req.method)) throw new ApiError(404, "Такого метода API нет.");
    const readToken = (name: string) => {
      const value = req.headers.get(name);
      if (value !== null && !tokenPattern.test(value)) throw new ApiError(400, "Некорректный токен браузера или сессии.");
      return value;
    };
    const visitor = readToken("X-Visitor-Token"), admin = readToken("X-Queue-Session"), display = readToken("X-Display-Token");
    if ((path === "/me/tickets" || path.startsWith("/queues/")) && !visitor) throw new ApiError(400, "Не удалось распознать браузер. Обновите страницу.");
    if (path.startsWith("/admin/") && path !== "/admin/login" && !admin) throw new ApiError(401, "Войдите в панель преподавателя.");
    let body: Record<string, unknown> = {};
    if (req.method !== "GET") {
      if (Number(req.headers.get("Content-Length") || 0) > 8192) throw new ApiError(413, "Слишком большой запрос.");
      const raw = await req.text();
      if (raw.length > 8192) throw new ApiError(413, "Слишком большой запрос.");
      try { body = raw ? JSON.parse(raw) : {}; } catch { throw new ApiError(400, "Некорректный JSON."); }
      if (!body || Array.isArray(body) || typeof body !== "object") throw new ApiError(400, "Некорректные данные.");
    }
    const login = path === "/admin/login" && req.method === "POST";
    if (login || req.method !== "GET") {
      // Gateway-supplied client address is used only for throttling, never identity.
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const allowed = await rpc("campus_rate", { p_key: `${login ? "login" : "write"}:${digest(ip)}`, p_limit: login ? 40 : 1000, p_window: login ? 900000 : 60000 });
      if (!allowed) throw new ApiError(429, login ? "Слишком много попыток входа. Подождите 15 минут." : "Слишком много запросов. Подождите минуту.");
    }
    if (login) {
      fields(body, ["username", "password"]);
      const username = text(body.username ?? "admin", "Логин", 32).toLowerCase(), password = text(body.password, "Пароль", 200);
      const accountAllowed = await rpc("campus_rate", { p_key: `account:${digest(username)}`, p_limit: 40, p_window: 900000 });
      if (!accountAllowed) throw new ApiError(429, "Слишком много попыток входа. Подождите 15 минут.");
      const hash = await rpc("campus_login_context", { p_username: username });
      if (!validPassword(password, hash)) throw new ApiError(401, "Неверный логин или пароль, либо аккаунт отключён.");
      body = { username, _verifiedHash: hash };
    } else if (path === "/admin/password" && req.method === "POST") {
      fields(body, ["currentPassword", "newPassword"]);
      const password = text(body.newPassword, "Новый пароль", 128);
      if (password.length < 8 || password !== body.newPassword) throw new ApiError(400, "Новый пароль: от 8 до 128 символов, без пробелов по краям.");
      const context = await rpc("campus_password_context", { p_session_hash: digest(admin!) });
      const allowed = await rpc("campus_rate", { p_key: `password:${context.id}`, p_limit: 20, p_window: 900000 });
      if (!allowed) throw new ApiError(429, "Слишком много попыток. Подождите 15 минут.");
      if (validPassword(password, context.hash)) throw new ApiError(400, "Новый пароль должен отличаться от текущего.");
      const salt = randomBytes(16).toString("hex");
      body = { _verifiedHash: context.hash, _hash: `${salt}:${scryptSync(password, salt, 64).toString("hex")}` };
    } else if ((path === "/admin/queues" && req.method === "POST") || (/^\/admin\/queues\/[^/]+\/settings$/.test(path) && req.method === "PATCH")) {
      fields(body, ["title", "room", "status", "avgMinutes", "maxQueue", "qrIntervalSeconds"]);
      const creating = path === "/admin/queues";
      if (creating || "title" in body) body.title = text(body.title, "Название", 80);
      if (creating || "room" in body) body.room = body.room === undefined || (typeof body.room === "string" && !body.room.trim())
        ? "" : text(body.room, "Аудитория", 60);
      if ("status" in body && !["open", "paused", "closed"].includes(String(body.status))) throw new ApiError(400, "Некорректный статус.");
      if ("avgMinutes" in body) integer(body.avgMinutes, 1, 120, "Время на студента");
      if ("maxQueue" in body) integer(body.maxQueue, 1, 500, "Лимит");
      if ("qrIntervalSeconds" in body) {
        integer(body.qrIntervalSeconds, 60, 600, "Интервал QR (секунды)");
        if (Number(body.qrIntervalSeconds) % 60 !== 0) throw new ApiError(400, "Интервал QR: от 1 до 10 целых минут.");
      }
    } else if (/^\/admin\/queues\/[^/]+\/invite-link$/.test(path) && req.method === "POST") {
      fields(body, ["intervalSeconds", "generation"]);
      integer(body.intervalSeconds, 60, 600, "Срок ссылки (секунды)");
      if (Number(body.intervalSeconds) % 60 !== 0) throw new ApiError(400, "Срок ссылки: от 1 до 10 целых минут.");
      integer(body.generation, 1, 1_000_000, "Номер пары");
    } else if (/^\/admin\/queues\/[^/]+\/tickets$/.test(path) && req.method === "POST") {
      fields(body, ["name", "requestId", "generation"]);
      body.name = text(body.name, "Имя", 60);
      body.requestId = text(body.requestId, "Запрос", 36).toLowerCase();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(body.requestId)))
        throw new ApiError(400, "Некорректный запрос записи.");
      integer(body.generation, 1, 1_000_000, "Номер пары");
    } else if (/^\/admin\/queues\/[^/]+\/reorder$/.test(path) && req.method === "POST") {
      fields(body, ["ticketId", "beforeTicketId", "generation"]);
      body.ticketId = text(body.ticketId, "Талон", 80);
      if (body.beforeTicketId !== null) body.beforeTicketId = text(body.beforeTicketId, "Место в очереди", 80);
      integer(body.generation, 1, 1_000_000, "Номер пары");
    } else if (/^\/queues\/[^/]+\/retake$/.test(path) && req.method === "POST") {
      fields(body, ["ticketId", "generation"]);
      body.ticketId = text(body.ticketId, "Талон", 80);
      integer(body.generation, 1, 1_000_000, "Номер пары");
    } else if (/^\/queues\/[^/]+\/join$/.test(path) && req.method === "POST") {
      fields(body, ["name", "studentGroup", "grantId"]);
      body.name = text(body.name, "Имя", 60);
      // Keep the legacy field compatible with already-open clients, but do not
      // require or collect a group for new enrollments.
      body.studentGroup = "";
      body.grantId = text(body.grantId, "Допуск", 80);
    } else if (/^\/queues\/[^/]+\/redeem$/.test(path) && req.method === "POST") {
      fields(body, ["invite"]); body.invite = text(body.invite, "QR", 2000);
    } else if (/^\/admin\/queues\/[^/]+\/next$/.test(path) && req.method === "POST") {
      fields(body, ["currentTicketId"]);
      if ("currentTicketId" in body) body.currentTicketId = text(body.currentTicketId, "Текущий талон", 80);
    } else if (/^\/admin\/queues\/[^/]+\/tickets\/[^/]+\/finish$/.test(path) && req.method === "POST") {
      fields(body, ["status"]); if (!["done", "skipped"].includes(String(body.status))) throw new ApiError(400, "Некорректный статус талона.");
    } else if (/^\/admin\/queues\/[^/]+\/end$/.test(path) && req.method === "POST") {
      fields(body, ["generation", "confirmation"]); integer(body.generation, 1, 1000000, "Номер пары");
      if (body.confirmation !== "ЗАВЕРШИТЬ") throw new ApiError(400, "Подтвердите завершение очереди.");
    } else if (/^\/admin\/queues\/[^/]+\/reset$/.test(path) && req.method === "POST") {
      fields(body, ["generation", "confirmation"]); integer(body.generation, 1, 1000000, "Номер пары");
      if (body.confirmation !== "НОВАЯ ПАРА") throw new ApiError(400, "Введите НОВАЯ ПАРА.");
    } else if (path === "/admin/teachers" && req.method === "POST") {
      fields(body, ["name", "username"]);
      body.name = text(body.name, "Имя преподавателя", 80); body.username = text(body.username, "Логин", 32).toLowerCase();
      if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(String(body.username))) throw new ApiError(400, "Логин: 3–32 латинские буквы, цифры, точка, дефис или _.");
      body = { ...body, ...passwordFields() };
    } else if (/^\/admin\/teachers\/[^/]+$/.test(path) && req.method === "PATCH") {
      fields(body, ["active", "resetPassword"]);
      if ("active" in body && typeof body.active !== "boolean") throw new ApiError(400, "Некорректный статус аккаунта.");
      if ("resetPassword" in body && body.resetPassword !== true) throw new ApiError(400, "Некорректный запрос сброса.");
      if (body.resetPassword) body = { ...body, ...passwordFields() };
    } else if (req.method !== "GET") fields(body, []);
    return respond(await rpc("campus_api", { p_method: req.method, p_path: path, p_credentials: { visitorHash: visitor ? digest(visitor) : null, adminHash: admin ? digest(admin) : null, displayHash: display ? digest(display) : null }, p_body: body }));
  } catch (error) {
    const known = error instanceof ApiError;
    return respond({ error: known ? error.message : "Сервер временно недоступен. Попробуйте ещё раз." }, known ? error.status : 503);
  }
});
