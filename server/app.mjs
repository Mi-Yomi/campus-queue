import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { AppError, createStore, digest } from "./store.mjs";
import { checkPassword } from "./auth.mjs";

const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;
function text(value, label, max) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > max ||
    /[\u0000-\u001F\u007F]/.test(value)
  )
    throw new AppError(400, `${label}: от 1 до ${max} символов.`);
  return value.trim();
}
function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new AppError(400, `${label}: число от ${min} до ${max}.`);
  return value;
}
function fields(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new AppError(400, "Некорректные данные.");
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new AppError(400, "Неизвестное поле.");
}
function settingsInput(body, required = false) {
  fields(body, ["title", "room", "status", "avgMinutes", "maxQueue"]);
  const result = {};
  if (required || "title" in body)
    result.title = text(body.title, "Название", 80);
  if (required || "room" in body)
    result.room = body.room === undefined || (typeof body.room === "string" && !body.room.trim())
      ? "" : text(body.room, "Аудитория", 60);
  if ("status" in body) {
    if (!["open", "paused", "closed"].includes(body.status))
      throw new AppError(400, "Некорректный статус.");
    result.status = body.status;
  }
  if ("avgMinutes" in body)
    result.avgMinutes = integer(body.avgMinutes, 1, 120, "Время на студента");
  if ("maxQueue" in body)
    result.maxQueue = integer(body.maxQueue, 1, 500, "Лимит");
  return result;
}
export function createApp(options = {}) {
  const passwordHash = options.passwordHash ?? process.env.ADMIN_PASSWORD_HASH;
  if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash ?? ""))
    throw new Error(
      "Выполните npm run setup: отсутствует ADMIN_PASSWORD_HASH.",
    );
  const store = createStore(
    options.databasePath ?? process.env.DATABASE_PATH ?? "./data/queue.sqlite",
    { passwordHash, now: options.now },
  );
  const origins = new Set(
    (options.allowedOrigins ?? process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .filter(Boolean),
  );
  const app = express();
  app.disable("x-powered-by");
  if (Number(process.env.TRUST_PROXY_HOPS) > 0)
    app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
      strictTransportSecurity:
        process.env.NODE_ENV === "production" ? undefined : false,
    }),
  );
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const origin = req.get("Origin");
    if (origin) {
      if (!origins.has(origin))
        return res
          .status(403)
          .json({ error: "Этот адрес сайта не разрешён в настройках API." });
      res.set("Access-Control-Allow-Origin", origin);
      res.vary("Origin");
      res.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Visitor-Token, X-Display-Token",
      );
      res.set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: "8kb" }));
  if (!options.disableRateLimit) {
    app.use(
      "/api",
      rateLimit({
        windowMs: 60_000,
        limit: 30000,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        message: { error: "Слишком много запросов. Подождите минуту." },
      }),
    );
    app.use(
      ["/api/admin/login", "/api/admin/password"],
      rateLimit({
        windowMs: 15 * 60_000,
        limit: 20,
        skipSuccessfulRequests: true,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        message: { error: "Слишком много попыток входа. Подождите 15 минут." },
      }),
    );
    const admissionLimit = rateLimit({
      windowMs: 60_000,
      limit: 1000,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Слишком много записей. Подождите минуту." },
    });
    app.use("/api/queues/:queueId/redeem", admissionLimit);
    app.use("/api/queues/:queueId/join", admissionLimit);
  }
  const visitor = (req) => {
    const token = req.get("X-Visitor-Token");
    if (!token || !tokenPattern.test(token))
      throw new AppError(
        400,
        "Не удалось распознать браузер. Обновите страницу.",
      );
    return token;
  };
  const bearer = (req) => {
    const header = req.get("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token || !tokenPattern.test(token))
      throw new AppError(401, "Войдите в панель преподавателя.");
    return token;
  };
  const auth = (req, _res, next) => {
    req.adminToken = bearer(req);
    req.user = store.authenticate(req.adminToken).user;
    next();
  };
  const manage = (req, _res, next) => {
    store.canManage(req.user, req.params.queueId);
    next();
  };
  app.get("/api/health", (_req, res) => res.json({ ok: true, version: 2 }));
  app.get("/api/me/tickets", (req, res) =>
    res.json({
      tickets: store.myTickets(visitor(req)),
      serverNow: store.now(),
    }),
  );
  app.get("/api/queues/:queueId", (req, res) =>
    res.json(
      store.snapshot(
        req.params.queueId,
        req.get("X-Visitor-Token") ? visitor(req) : undefined,
      ),
    ),
  );
  app.post("/api/queues/:queueId/redeem", (req, res) => {
    store.redeem(req.params.queueId, visitor(req), req.body?.invite);
    res.json(store.snapshot(req.params.queueId, visitor(req)));
  });
  app.post("/api/queues/:queueId/join", (req, res) => {
    store.join(
      req.params.queueId,
      visitor(req),
      text(req.body?.name, "Имя", 60),
      "",
      req.body?.grantId,
    );
    res.json(store.snapshot(req.params.queueId, visitor(req)));
  });
  app.post("/api/queues/:queueId/leave", (req, res) => {
    store.cancel(req.params.queueId, visitor(req));
    res.json(store.snapshot(req.params.queueId, visitor(req)));
  });
  app.get("/api/queues/:queueId/invite", (req, res) =>
    res.json(
      store.issueInvite(req.params.queueId, { visitorToken: visitor(req) }),
    ),
  );
  app.get("/api/display/queues/:queueId/invite", (req, res) => {
    const token = req.get("X-Display-Token");
    if (!token || !tokenPattern.test(token))
      throw new AppError(401, "Откройте табло из панели преподавателя.");
    res.json(store.issueInvite(req.params.queueId, { displayToken: token }));
  });
  // Read-only compatibility keeps old bookmarks/tickets recoverable. No QR bypass.
  app.get("/api/queue", (req, res) =>
    res.json(
      store.snapshot(
        "legacy",
        req.get("X-Visitor-Token") ? visitor(req) : undefined,
      ),
    ),
  );
  app.post("/api/join", (_req, res) =>
    res
      .status(410)
      .json({ error: "Для записи нужен свежий QR-код. Обновите сайт." }),
  );
  app.post("/api/admin/login", (req, res) => {
    const password = text(req.body?.password, "Пароль", 200),
      username = text(req.body?.username ?? "admin", "Логин", 32).toLowerCase();
    const account = store.db
      .prepare("SELECT * FROM users WHERE username=?")
      .get(username);
    const valid = checkPassword(
      password,
      account?.passwordHash ?? passwordHash,
    );
    if (!account || !account.active || !valid)
      throw new AppError(
        401,
        "Неверный логин или пароль, либо аккаунт отключён.",
      );
    res.json({
      token: store.createSession(account.id),
      user: store.safeUser(account),
    });
  });
  app.use("/api/admin", auth);
  app.get("/api/admin/me", (req, res) => res.json({ user: req.user }));
  app.post("/api/admin/password", (req, res) => {
    fields(req.body, ["currentPassword", "newPassword"]);
    const password = text(req.body.newPassword, "Новый пароль", 128);
    if (password.length < 8 || password !== req.body.newPassword)
      throw new AppError(400, "Новый пароль: от 8 до 128 символов, без пробелов по краям.");
    res.json(store.changePassword(req.adminToken, password));
  });
  app.post("/api/admin/logout", (req, res) => {
    store.db
      .prepare("DELETE FROM auth_sessions WHERE tokenHash=?")
      .run(digest(req.adminToken));
    res.json({ ok: true });
  });
  app.use("/api/admin", (req, _res, next) => {
    if (req.user.passwordChangeSuggested)
      throw new AppError(403, "Сначала задайте свой пароль вместо временного.");
    next();
  });
  app.get("/api/admin/queues", (req, res) =>
    res.json({ queues: store.listQueues(req.user) }),
  );
  app.post("/api/admin/queues", (req, res) =>
    res
      .status(201)
      .json({
        queue: store.createQueue(req.user, settingsInput(req.body, true)),
      }),
  );
  app.use("/api/admin/queues/:queueId", manage);
  app.get("/api/admin/queues/:queueId", (req, res) =>
    res.json(store.snapshot(req.params.queueId, undefined, true)),
  );
  app.patch("/api/admin/queues/:queueId/settings", (req, res) => {
    store.updateSettings(req.params.queueId, settingsInput(req.body));
    res.json(store.snapshot(req.params.queueId, undefined, true));
  });
  app.post("/api/admin/queues/:queueId/next", (req, res) => {
    fields(req.body ?? {}, ["currentTicketId"]);
    const currentTicketId = req.body?.currentTicketId === undefined ? undefined
      : text(req.body.currentTicketId, "Текущий талон", 80);
    store.next(req.params.queueId, currentTicketId);
    res.json(store.snapshot(req.params.queueId, undefined, true));
  });
  app.post("/api/admin/queues/:queueId/tickets/:id/finish", (req, res) => {
    if (!["done", "skipped"].includes(req.body?.status))
      throw new AppError(400, "Некорректный статус талона.");
    store.finish(req.params.queueId, req.params.id, req.body.status);
    res.json(store.snapshot(req.params.queueId, undefined, true));
  });
  app.post("/api/admin/queues/:queueId/end", (req, res) => {
    fields(req.body, ["confirmation", "generation"]);
    if (req.body?.confirmation !== "ЗАВЕРШИТЬ") throw new AppError(400, "Подтвердите завершение очереди.");
    store.endQueue(req.params.queueId, integer(req.body.generation, 1, 1_000_000, "Номер пары"));
    res.json({ ok: true });
  });
  app.post("/api/admin/queues/:queueId/reset", (req, res) => {
    if (req.body?.confirmation !== "НОВАЯ ПАРА")
      throw new AppError(400, "Введите НОВАЯ ПАРА.");
    store.reset(
      req.params.queueId,
      integer(req.body.generation, 1, 1_000_000, "Номер пары"),
    );
    res.json(store.snapshot(req.params.queueId, undefined, true));
  });
  app.get("/api/admin/queues/:queueId/invite", (req, res) =>
    res.json(
      store.issueInvite(req.params.queueId, { sessionToken: req.adminToken }),
    ),
  );
  app.post("/api/admin/queues/:queueId/display-session", (req, res) => {
    const q = store.queue(req.params.queueId);
    if (q.endedAt) throw new AppError(410, "Очередь завершена.");
    res.json({
      token: store.createSession(req.user.id, "display", q),
      generation: q.generation,
    });
  });
  app.get("/api/admin/teachers", (req, res) => {
    store.ownerOnly(req.user);
    res.json({
      teachers: store.db
        .prepare("SELECT * FROM users WHERE role='teacher' ORDER BY name")
        .all()
        .map(store.safeUser),
    });
  });
  app.post("/api/admin/teachers", (req, res) => {
    store.ownerOnly(req.user);
    fields(req.body, ["username", "name"]);
    const username = text(req.body.username, "Логин", 32).toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username))
      throw new AppError(
        400,
        "Логин: 3–32 латинские буквы, цифры, точка, дефис или _.",
      );
    res
      .status(201)
      .json(
        store.createTeacher(req.user, {
          username,
          name: text(req.body.name, "Имя преподавателя", 80),
        }),
      );
  });
  app.patch("/api/admin/teachers/:id", (req, res) => {
    store.ownerOnly(req.user);
    fields(req.body, ["active", "resetPassword"]);
    if ("active" in req.body && typeof req.body.active !== "boolean")
      throw new AppError(400, "Некорректный статус аккаунта.");
    if ("resetPassword" in req.body && req.body.resetPassword !== true)
      throw new AppError(400, "Некорректный запрос сброса.");
    res.json(store.changeTeacher(req.user, req.params.id, req.body));
  });
  app.get("/api/admin/network", (_req, res) =>
    res.json({
      addresses: Object.entries(networkInterfaces())
        .sort(
          ([a], [b]) =>
            Number(/vmware|virtual|vethernet/i.test(a)) -
            Number(/vmware|virtual|vethernet/i.test(b)),
        )
        .flatMap(([, values]) => values)
        .filter(
          (x) =>
            x.family === "IPv4" &&
            !x.internal &&
            !x.address.startsWith("169.254."),
        )
        .map((x) => x.address),
    }),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Такого метода API нет." }),
  );
  if (existsSync(resolve("dist"))) app.use(express.static(resolve("dist")));
  app.use((error, _req, res, _next) => {
    const status = error.status ?? 500;
    if (status >= 500) console.error(error);
    res
      .status(status)
      .json({
        error:
          status >= 500
            ? "Не удалось выполнить действие. Попробуйте ещё раз."
            : error.type === "entity.parse.failed"
              ? "Некорректный JSON."
              : error.message,
      });
  });
  return { app, store };
}
