import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  createHash,
  createHmac,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { newToken, newPassword, hashPassword } from "./auth.mjs";
import { serviceAnalytics, estimateMinutes } from "../src/queue-analytics.mjs";

export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new AppError(status, message);
};
export const QR_INTERVAL = 20_000;
export const GRANT_TTL = 120_000;
export function createStore(filename, { passwordHash, now = Date.now } = {}) {
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;",
  );
  const tx = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const stamp = () => new Date(now()).toISOString();
  const legacy = !!db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'",
    )
    .get();
  const schema = db.prepare("PRAGMA user_version").get().user_version;
  if (schema < 2) {
    if (
      legacy &&
      filename !== ":memory:" &&
      !existsSync(`${filename}.pre-v2.bak`)
    )
      db.prepare("VACUUM INTO ?").run(`${filename}.pre-v2.bak`);
    tx(() => {
      db.exec(`
        CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','teacher')), passwordHash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL);
        CREATE TABLE queues(id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, room TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', avgMinutes INTEGER NOT NULL DEFAULT 5, maxQueue INTEGER NOT NULL DEFAULT 60, generation INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL);
        CREATE TABLE queue_tickets(id TEXT PRIMARY KEY, queueId TEXT NOT NULL REFERENCES queues(id), generation INTEGER NOT NULL, seq INTEGER NOT NULL, number TEXT NOT NULL, visitorHash TEXT NOT NULL, name TEXT NOT NULL, studentGroup TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL, calledAt TEXT, finishedAt TEXT, UNIQUE(queueId,generation,seq));
        CREATE UNIQUE INDEX idx_active_per_queue ON queue_tickets(queueId,visitorHash) WHERE status IN ('waiting','called');
        CREATE UNIQUE INDEX idx_called_per_queue ON queue_tickets(queueId,generation) WHERE status='called';
        CREATE INDEX idx_queue_status ON queue_tickets(queueId,generation,status,seq);
        CREATE INDEX idx_visitor_tickets ON queue_tickets(visitorHash,createdAt);
        CREATE TABLE auth_sessions(tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL DEFAULT 'admin', queueId TEXT, generation INTEGER, expiresAt INTEGER NOT NULL);
        CREATE TABLE admission_grants(id TEXT PRIMARY KEY, inviteHash TEXT NOT NULL, queueId TEXT NOT NULL REFERENCES queues(id), generation INTEGER NOT NULL, visitorHash TEXT NOT NULL, expiresAt INTEGER NOT NULL, consumedTicketId TEXT REFERENCES queue_tickets(id), UNIQUE(inviteHash,visitorHash));
        CREATE INDEX idx_visitor_grants ON admission_grants(queueId,visitorHash,expiresAt);
        CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      `);
      db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?,?)").run(
        "owner",
        "admin",
        "Администратор",
        "owner",
        passwordHash,
        1,
        stamp(),
      );
      db.prepare("INSERT INTO app_meta VALUES(?,?)").run(
        "invite_secret",
        newToken(),
      );
      const old = legacy
        ? db.prepare("SELECT * FROM settings WHERE id=1").get()
        : null;
      db.prepare("INSERT INTO queues VALUES(?,?,?,?,?,?,?,?,?)").run(
        "legacy",
        "owner",
        old?.title ?? "Сдача работ",
        old?.room ?? "Аудитория 302",
        old?.status ?? "open",
        old?.avgMinutes ?? 5,
        old?.maxQueue ?? 60,
        old?.generation ?? 1,
        stamp(),
      );
      if (legacy) {
        db.exec(
          "INSERT INTO queue_tickets SELECT id,'legacy',generation,seq,number,visitorHash,name,studentGroup,status,createdAt,calledAt,finishedAt FROM tickets;",
        );
        // Old sessions had a single known administrator; preserve only as owner sessions.
        db.exec(
          "INSERT INTO auth_sessions(tokenHash,userId,expiresAt) SELECT tokenHash,'owner',expiresAt FROM sessions;",
        );
        db.exec(
          "DROP TABLE tickets; DROP TABLE sessions; DROP TABLE settings;",
        );
      }
      db.exec("PRAGMA user_version=2;");
    });
  }
  const secret = db
    .prepare("SELECT value FROM app_meta WHERE key='invite_secret'")
    .get().value;
  const safeUser = (row) =>
    row
      ? {
          id: row.id,
          username: row.username,
          name: row.name,
          role: row.role,
          active: !!row.active,
          createdAt: row.createdAt,
        }
      : null;
  const user = (id) => db.prepare("SELECT * FROM users WHERE id=?").get(id);
  const clean = (row) => {
    if (!row) return null;
    const { visitorHash, ...ticket } = row;
    return ticket;
  };
  function queue(id) {
    const row = db
      .prepare(
        "SELECT q.*,u.name AS teacherName,u.active AS teacherActive FROM queues q JOIN users u ON q.ownerId=u.id WHERE q.id=?",
      )
      .get(id);
    if (!row) fail(404, "Очередь не найдена.");
    return { ...row, teacherActive: !!row.teacherActive };
  }
  function canManage(actor, id) {
    const q = queue(id);
    if (!actor || (actor.role !== "owner" && q.ownerId !== actor.id))
      fail(403, "У вас нет доступа к этой очереди.");
    return q;
  }
  const ownerOnly = (actor) => {
    if (actor?.role !== "owner")
      fail(403, "Это действие доступно только владельцу.");
  };
  function requireOpen(q) {
    if (!q.teacherActive) fail(409, "Аккаунт преподавателя приостановлен.");
    if (q.status !== "open") fail(409, "Запись сейчас закрыта.");
  }
  function authenticate(token, kind = "admin") {
    const row = db
      .prepare(
        "SELECT s.*,u.active FROM auth_sessions s JOIN users u ON u.id=s.userId WHERE s.tokenHash=?",
      )
      .get(digest(token));
    if (!row || row.kind !== kind || row.expiresAt <= now() || !row.active)
      fail(401, "Сессия истекла. Войдите снова.");
    return { session: row, user: safeUser(user(row.userId)) };
  }
  function createSession(userId, kind = "admin", q = null) {
    const token = newToken();
    db.prepare("DELETE FROM auth_sessions WHERE expiresAt<=?").run(now());
    db.prepare("INSERT INTO auth_sessions VALUES(?,?,?,?,?,?)").run(
      digest(token),
      userId,
      kind,
      q?.id ?? null,
      q?.generation ?? null,
      now() + 12 * 60 * 60_000,
    );
    return token;
  }
  function listQueues(actor) {
    const ids =
      actor.role === "owner"
        ? db.prepare("SELECT id FROM queues ORDER BY createdAt DESC,id").all()
        : db
            .prepare(
              "SELECT id FROM queues WHERE ownerId=? ORDER BY createdAt DESC,id",
            )
            .all(actor.id);
    return ids.map(({ id }) => ({
      ...queue(id),
      waiting: db
        .prepare(
          "SELECT COUNT(*) AS n FROM queue_tickets WHERE queueId=? AND generation=? AND status='waiting'",
        )
        .get(id, queue(id).generation).n,
    }));
  }
  function createQueue(
    actor,
    { title, room, avgMinutes = 5, maxQueue = 60, status = "open" },
  ) {
    const id = randomUUID();
    db.prepare("INSERT INTO queues VALUES(?,?,?,?,?,?,?,?,?)").run(
      id,
      actor.id,
      title,
      room,
      status,
      avgMinutes,
      maxQueue,
      1,
      stamp(),
    );
    return queue(id);
  }
  function snapshot(id, visitorToken, admin = false) {
    const q = queue(id);
    const tickets = db
      .prepare(
        "SELECT * FROM queue_tickets WHERE queueId=? AND generation=? ORDER BY seq",
      )
      .all(id, q.generation);
    const waiting = tickets.filter((t) => t.status === "waiting"),
      current = tickets.find((t) => t.status === "called");
    const analytics = serviceAnalytics(tickets);
    const hash = visitorToken ? digest(visitorToken) : "";
    const mine = clean(
      hash
        ? db
            .prepare(
              "SELECT * FROM queue_tickets WHERE queueId=? AND visitorHash=? ORDER BY generation DESC,seq DESC LIMIT 1",
            )
            .get(id, hash)
        : null,
    );
    if (mine) {
      const index = waiting.findIndex((t) => t.id === mine.id);
      mine.position = index < 0 ? 0 : index + 1;
      mine.ahead = index < 0 ? 0 : index + (current ? 1 : 0);
      mine.estimatedMinutes = estimateMinutes(mine.ahead, analytics);
      mine.previousSession = mine.generation !== q.generation;
    }
    const admission = hash
      ? db
          .prepare(
            "SELECT id,expiresAt,generation FROM admission_grants WHERE queueId=? AND generation=? AND visitorHash=? AND consumedTicketId IS NULL AND expiresAt>? ORDER BY expiresAt DESC LIMIT 1",
          )
          .get(id, q.generation, hash, now())
      : null;
    return {
      settings: q,
      analytics,
      serverTime: stamp(),
      serverNow: now(),
      mine,
      admission: admission ?? null,
      canShare: !!(
        q.teacherActive &&
        q.status === "open" &&
        mine &&
        !mine.previousSession &&
        ["waiting", "called"].includes(mine.status)
      ),
      stats: {
        waiting: waiting.length,
        completed: tickets.filter((t) => t.status === "done").length,
        skipped: tickets.filter((t) => t.status === "skipped").length,
        total: tickets.length,
      },
      current: current
        ? admin
          ? clean(current)
          : { number: current.number, calledAt: current.calledAt }
        : null,
      nextNumbers: waiting.slice(0, 5).map((t) => t.number),
      ...(admin ? { tickets: tickets.map(clean) } : {}),
    };
  }
  function myTickets(token) {
    const rows = db
      .prepare(
        "SELECT * FROM queue_tickets WHERE visitorHash=? ORDER BY createdAt DESC,rowid DESC",
      )
      .all(digest(token));
    const seen = new Set();
    return rows
      .filter((row) => {
        if (seen.has(row.queueId)) return false;
        seen.add(row.queueId);
        return true;
      })
      .slice(0, 30)
      .map((row) => ({ ...clean(row), queue: queue(row.queueId) }));
  }
  function issuerValid(claims, q) {
    if (claims.kind === "ticket") {
      const ticket = db
        .prepare(
          "SELECT * FROM queue_tickets WHERE id=? AND queueId=? AND generation=?",
        )
        .get(claims.issuer, q.id, q.generation);
      if (!ticket || !["waiting", "called"].includes(ticket.status))
        fail(410, "Этот QR больше не действует. Попросите свежий код.");
    } else if (claims.kind === "session") {
      const s = db
        .prepare("SELECT * FROM auth_sessions WHERE tokenHash=?")
        .get(claims.issuer);
      const actor = s && user(s.userId);
      if (
        !s ||
        s.expiresAt <= now() ||
        !actor?.active ||
        (actor.role !== "owner" && actor.id !== q.ownerId) ||
        (s.kind === "display" &&
          (s.queueId !== q.id || s.generation !== q.generation))
      )
        fail(410, "QR отозван. Попросите свежий код.");
    } else fail(400, "Некорректное приглашение.");
  }
  function issueInvite(id, { visitorToken, sessionToken, displayToken } = {}) {
    const q = queue(id);
    requireOpen(q);
    let kind, issuer;
    if (sessionToken) {
      const auth = authenticate(sessionToken);
      canManage(auth.user, id);
      kind = "session";
      issuer = digest(sessionToken);
    } else if (displayToken) {
      const auth = authenticate(displayToken, "display");
      if (
        auth.session.queueId !== id ||
        auth.session.generation !== q.generation
      )
        fail(403, "Табло относится к другой паре. Откройте новое из панели.");
      kind = "session";
      issuer = digest(displayToken);
    } else {
      const row = db
        .prepare(
          "SELECT id FROM queue_tickets WHERE queueId=? AND generation=? AND visitorHash=? AND status IN ('waiting','called')",
        )
        .get(id, q.generation, digest(visitorToken));
      if (!row)
        fail(
          403,
          "Показать QR может только студент с активным талоном этой пары.",
        );
      kind = "ticket";
      issuer = row.id;
    }
    const iat = now(),
      exp = iat + QR_INTERVAL;
    const payload = Buffer.from(
      JSON.stringify({ v: 1, q: id, g: q.generation, kind, issuer, iat, exp }),
    ).toString("base64url");
    const signature = createHmac("sha256", secret)
      .update(payload)
      .digest("base64url");
    return {
      invite: `${payload}.${signature}`,
      expiresAt: exp,
      serverNow: now(),
      intervalMs: QR_INTERVAL,
    };
  }
  function verifyInvite(id, raw) {
    if (typeof raw !== "string" || raw.length > 1600)
      fail(400, "Некорректный QR-код.");
    const [payload, sig, ...rest] = raw.split(".");
    if (
      !payload ||
      !sig ||
      rest.length ||
      !/^[\w-]+$/.test(payload) ||
      !/^[\w-]+$/.test(sig)
    )
      fail(400, "Некорректный QR-код.");
    const expected = createHmac("sha256", secret).update(payload).digest();
    const actual = Buffer.from(sig, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      fail(400, "Подпись QR-кода не прошла проверку.");
    let claims;
    try {
      claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    } catch {
      fail(400, "Некорректный QR-код.");
    }
    if (
      !claims ||
      claims.v !== 1 ||
      claims.q !== id ||
      !Number.isInteger(claims.g) ||
      !Number.isInteger(claims.iat) ||
      !Number.isInteger(claims.exp) ||
      claims.exp - claims.iat !== QR_INTERVAL ||
      typeof claims.issuer !== "string"
    )
      fail(400, "QR относится к другой очереди или повреждён.");
    if (now() >= claims.exp || now() < claims.iat)
      fail(
        410,
        "QR-код устарел. Отсканируйте текущий код у преподавателя или одногруппника.",
      );
    const q = queue(id);
    if (q.generation !== claims.g)
      fail(410, "Эта пара уже завершена. Нужен новый QR.");
    requireOpen(q);
    issuerValid(claims, q);
    return claims;
  }
  function redeem(id, token, invite) {
    return tx(() => {
      const hash = digest(token),
        q = queue(id);
      const active = db
        .prepare(
          "SELECT id FROM queue_tickets WHERE queueId=? AND visitorHash=? AND generation=? AND status IN ('waiting','called')",
        )
        .get(id, hash, q.generation);
      if (active) return { alreadyJoined: true };
      const claims = verifyInvite(id, invite);
      const inviteHash = digest(invite);
      const existing = db
        .prepare(
          "SELECT id,expiresAt,consumedTicketId FROM admission_grants WHERE inviteHash=? AND visitorHash=?",
        )
        .get(inviteHash, hash);
      if (existing) return existing;
      const grant = { id: randomUUID(), expiresAt: now() + GRANT_TTL };
      db.prepare("INSERT INTO admission_grants VALUES(?,?,?,?,?,?,NULL)").run(
        grant.id,
        inviteHash,
        id,
        claims.g,
        hash,
        grant.expiresAt,
      );
      return grant;
    });
  }
  function join(id, token, name, studentGroup, grantId) {
    return tx(() => {
      const hash = digest(token),
        q = queue(id);
      const grant =
        typeof grantId === "string"
          ? db
              .prepare(
                "SELECT * FROM admission_grants WHERE id=? AND queueId=? AND visitorHash=?",
              )
              .get(grantId, id, hash)
          : null;
      if (grant?.consumedTicketId)
        return clean(
          db
            .prepare("SELECT * FROM queue_tickets WHERE id=?")
            .get(grant.consumedTicketId),
        );
      const existing = db
        .prepare(
          "SELECT * FROM queue_tickets WHERE queueId=? AND visitorHash=? AND status IN ('waiting','called')",
        )
        .get(id, hash);
      if (existing) return clean(existing);
      requireOpen(q);
      if (
        !grant ||
        grant.expiresAt <= now() ||
        grant.generation !== q.generation
      )
        fail(410, "Время записи истекло. Отсканируйте свежий QR-код.");
      const count = db
        .prepare(
          "SELECT COUNT(*) AS n FROM queue_tickets WHERE queueId=? AND generation=? AND status IN ('waiting','called')",
        )
        .get(id, q.generation).n;
      if (count >= q.maxQueue)
        fail(409, "Очередь заполнена. Попробуйте, когда освободится место.");
      const seq = db
        .prepare(
          "SELECT COALESCE(MAX(seq),0)+1 AS n FROM queue_tickets WHERE queueId=? AND generation=?",
        )
        .get(id, q.generation).n;
      const ticket = {
        id: randomUUID(),
        number: `A-${String(seq).padStart(3, "0")}`,
      };
      db.prepare(
        "INSERT INTO queue_tickets VALUES(?,?,?,?,?,?,?,?,'waiting',?,NULL,NULL)",
      ).run(
        ticket.id,
        id,
        q.generation,
        seq,
        ticket.number,
        hash,
        name,
        studentGroup,
        stamp(),
      );
      db.prepare(
        "UPDATE admission_grants SET consumedTicketId=? WHERE id=?",
      ).run(ticket.id, grant.id);
      return clean(
        db.prepare("SELECT * FROM queue_tickets WHERE id=?").get(ticket.id),
      );
    });
  }
  function cancel(id, token) {
    return tx(() => {
      const row = db
        .prepare(
          "SELECT id FROM queue_tickets WHERE queueId=? AND visitorHash=? AND status IN ('waiting','called')",
        )
        .get(id, digest(token));
      if (!row) fail(409, "Активного талона нет.");
      db.prepare(
        "UPDATE queue_tickets SET status='cancelled',finishedAt=? WHERE id=?",
      ).run(stamp(), row.id);
    });
  }
  function next(id) {
    return tx(() => {
      const q = queue(id);
      if (
        db
          .prepare(
            "SELECT id FROM queue_tickets WHERE queueId=? AND generation=? AND status='called'",
          )
          .get(id, q.generation)
      )
        fail(409, "Сначала завершите приём текущего студента.");
      const row = db
        .prepare(
          "SELECT id FROM queue_tickets WHERE queueId=? AND generation=? AND status='waiting' ORDER BY seq LIMIT 1",
        )
        .get(id, q.generation);
      if (!row) fail(409, "Очередь пока пуста.");
      db.prepare(
        "UPDATE queue_tickets SET status='called',calledAt=? WHERE id=?",
      ).run(stamp(), row.id);
    });
  }
  function finish(id, ticketId, status) {
    return tx(() => {
      const row = db
        .prepare(
          "SELECT * FROM queue_tickets WHERE id=? AND queueId=? AND generation=?",
        )
        .get(ticketId, id, queue(id).generation);
      if (!row || row.status !== "called")
        fail(409, "Этот талон уже не находится на приёме.");
      db.prepare(
        "UPDATE queue_tickets SET status=?,finishedAt=? WHERE id=?",
      ).run(status, stamp(), ticketId);
    });
  }
  function updateSettings(id, values) {
    const q = { ...queue(id), ...values };
    db.prepare(
      "UPDATE queues SET title=?,room=?,status=?,avgMinutes=?,maxQueue=? WHERE id=?",
    ).run(q.title, q.room, q.status, q.avgMinutes, q.maxQueue, id);
  }
  function reset(id, generation) {
    return tx(() => {
      if (queue(id).generation !== generation)
        fail(409, "Новая пара уже начата в другой вкладке.");
      db.prepare(
        "UPDATE queue_tickets SET status='cancelled',finishedAt=? WHERE queueId=? AND status IN ('waiting','called')",
      ).run(stamp(), id);
      db.prepare(
        "UPDATE queues SET generation=generation+1,status='open' WHERE id=?",
      ).run(id);
      db.prepare(
        "DELETE FROM auth_sessions WHERE kind='display' AND queueId=?",
      ).run(id);
    });
  }
  function createTeacher(actor, { username, name }) {
    ownerOnly(actor);
    if (db.prepare("SELECT id FROM users WHERE username=?").get(username))
      fail(409, "Этот логин уже занят.");
    const password = newPassword(),
      id = randomUUID();
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?,?)").run(
      id,
      username,
      name,
      "teacher",
      hashPassword(password),
      1,
      stamp(),
    );
    return { user: safeUser(user(id)), password };
  }
  function changeTeacher(actor, id, { active, resetPassword } = {}) {
    ownerOnly(actor);
    const target = user(id);
    if (!target || target.role !== "teacher")
      fail(404, "Преподаватель не найден.");
    return tx(() => {
      let password;
      if (active !== undefined)
        db.prepare("UPDATE users SET active=? WHERE id=?").run(
          active ? 1 : 0,
          id,
        );
      if (resetPassword) {
        password = newPassword();
        db.prepare("UPDATE users SET passwordHash=? WHERE id=?").run(
          hashPassword(password),
          id,
        );
      }
      if (active === false || resetPassword)
        db.prepare("DELETE FROM auth_sessions WHERE userId=?").run(id);
      if (active === false)
        db.prepare(
          "UPDATE admission_grants SET expiresAt=0 WHERE queueId IN (SELECT id FROM queues WHERE ownerId=?) AND consumedTicketId IS NULL",
        ).run(id);
      return { user: safeUser(user(id)), ...(password ? { password } : {}) };
    });
  }
  return {
    db,
    now,
    queue,
    canManage,
    ownerOnly,
    safeUser,
    user,
    authenticate,
    createSession,
    listQueues,
    createQueue,
    snapshot,
    myTickets,
    issueInvite,
    redeem,
    join,
    cancel,
    next,
    finish,
    updateSettings,
    reset,
    createTeacher,
    changeTeacher,
    close: () => db.close(),
  };
}
