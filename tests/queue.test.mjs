import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/app.mjs";
import { hashPassword } from "../server/auth.mjs";
import { digest } from "../server/store.mjs";
const password = "test-owner-password",
  passwordHash = hashPassword(password);
const visitor = () => randomBytes(32).toString("hex");
function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), "campusqueue-v2-"));
  t.after(() => {
    assert.equal(resolve(dirname(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("campusqueue-v2-"));
    rmSync(dir, { recursive: true, force: true });
  });
  return join(dir, "test.sqlite");
}
async function fixture(
  t,
  {
    databasePath = ":memory:",
    clock = { value: Date.parse("2026-10-01T12:00:00.000Z") },
  } = {},
) {
  const { app, store } = createApp({
    passwordHash,
    databasePath,
    allowedOrigins: "https://example.github.io",
    disableRateLimit: true,
    now: () => clock.value,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise((r) => server.close(r));
    store.close();
  };
  t.after(close);
  const call = async (
    path,
    { method = "GET", body, token, admin, display, origin } = {},
  ) => {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers["X-Visitor-Token"] = token;
    if (admin) headers.Authorization = `Bearer ${admin}`;
    if (display) headers["X-Display-Token"] = display;
    if (origin) headers.Origin = origin;
    const r = await fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    return {
      status: r.status,
      body: r.status === 204 ? null : await r.json(),
      headers: r.headers,
    };
  };
  const login = async (username = "admin", pass = password) =>
    (
      await call("/admin/login", {
        method: "POST",
        body: { username, password: pass },
      })
    ).body.token;
  const owner = await login();
  const invite = async (q = "legacy", admin = owner) =>
    (await call(`/admin/queues/${q}/invite`, { admin })).body;
  const redeem = async (q, token, code) =>
    await call(`/queues/${q}/redeem`, {
      method: "POST",
      token,
      body: { invite: code },
    });
  const enroll = async (q = "legacy", token = visitor(), code = null) => {
    const qr = code ?? (await invite(q)).invite;
    const grant = await redeem(q, token, qr);
    assert.equal(grant.status, 200, JSON.stringify(grant.body));
    return call(`/queues/${q}/join`, {
      method: "POST",
      token,
      body: {
        name: "Тестовый студент",
        grantId: grant.body.admission?.id,
      },
    });
  };
  const teacher = async (name) => {
    const created = await call("/admin/teachers", {
      method: "POST",
      admin: owner,
      body: { username: name, name },
    });
    assert.equal(created.status, 201);
    const token = await login(name, created.body.password);
    const q = await call("/admin/queues", {
      method: "POST",
      admin: token,
      body: { title: `Пара ${name}`, room: "302" },
    });
    assert.equal(q.status, 201);
    return { user: created.body.user, token, q: q.body.queue.id };
  };
  return {
    store,
    call,
    login,
    owner,
    invite,
    redeem,
    enroll,
    teacher,
    clock,
    close,
  };
}
test("name-only enrollment and measured service averages exclude gaps, skips and other classes", async (t) => {
  const f = await fixture(t), people = Array.from({ length: 5 }, visitor);
  for (const token of people) {
    const enrolled = await f.enroll("legacy", token);
    assert.equal(enrolled.status, 200);
    assert.equal(enrolled.body.mine.studentGroup, "");
  }
  const snapshot = async () => (await f.call("/queues/legacy", { token: people[4] })).body;
  let s = await snapshot();
  assert.equal(s.analytics.sampleCount, 0);
  assert.equal(s.analytics.averageSeconds, null);
  assert.equal(s.mine.estimatedMinutes, null);
  const finishAfter = async (minutes, status = "done") => {
    const next = await f.call("/admin/queues/legacy/next", { admin: f.owner, method: "POST" });
    f.clock.value += minutes * 60000;
    return f.call(`/admin/queues/legacy/tickets/${next.body.current.id}/finish`, { admin: f.owner, method: "POST", body: { status } });
  };
  await finishAfter(7);
  assert.equal((await snapshot()).analytics.averageSeconds, 420);
  f.clock.value += 30 * 60000; // A break between students is not service time.
  await finishAfter(5);
  s = await snapshot();
  assert.deepEqual(s.analytics, { sampleCount: 2, totalSeconds: 720, averageSeconds: 360 });
  assert.equal(s.mine.ahead, 2);
  assert.equal(s.mine.estimatedMinutes, 12);
  await finishAfter(40, "skipped");
  s = await snapshot();
  assert.equal(s.analytics.averageSeconds, 360);
  assert.equal(s.analytics.sampleCount, 2);
  await f.call("/queues/legacy/leave", { token: people[3], method: "POST" });
  assert.equal((await snapshot()).mine.estimatedMinutes, 0);
  const other = await f.teacher("analytics_other");
  assert.equal((await f.enroll(other.q)).body.analytics.sampleCount, 0);
  await f.call("/admin/queues/legacy/settings", { admin: f.owner, method: "PATCH", body: { avgMinutes: 99 } });
  assert.equal((await snapshot()).analytics.averageSeconds, 360);
  await f.call("/admin/queues/legacy/reset", { admin: f.owner, method: "POST", body: { generation: 1, confirmation: "НОВАЯ ПАРА" } });
  s = await snapshot();
  assert.equal(s.analytics.sampleCount, 0);
  assert.equal(s.analytics.averageSeconds, null);
});
test("teachers have separate queues, tickets and simultaneous service", async (t) => {
  const f = await fixture(t),
    a = await f.teacher("teacher_a"),
    b = await f.teacher("teacher_b"),
    token = visitor();
  await f.enroll(a.q, token);
  await f.enroll(b.q, token);
  assert.equal((await f.call("/me/tickets", { token })).body.tickets.length, 2);
  const result = await Promise.all([
    f.call(`/admin/queues/${a.q}/next`, { admin: a.token, method: "POST" }),
    f.call(`/admin/queues/${b.q}/next`, { admin: b.token, method: "POST" }),
  ]);
  assert.ok(result.every((r) => r.status === 200));
  assert.ok(result.every((r) => r.body.current.number === "A-001"));
});
test("teacher cannot read or change another queue or manage accounts", async (t) => {
  const f = await fixture(t),
    a = await f.teacher("teacher_a"),
    b = await f.teacher("teacher_b");
  for (const [path, method, body] of [
    [`/admin/queues/${a.q}`, "GET"],
    [`/admin/queues/${a.q}/invite`, "GET"],
    [`/admin/queues/${a.q}/next`, "POST"],
    [`/admin/queues/${a.q}/settings`, "PATCH", { title: "hacked" }],
    [
      `/admin/queues/${a.q}/reset`,
      "POST",
      { confirmation: "НОВАЯ ПАРА", generation: 1 },
    ],
    [`/admin/queues/${a.q}/display-session`, "POST"],
    ["/admin/teachers", "GET"],
    ["/admin/teachers", "POST", { username: "outsider", name: "X" }],
  ])
    assert.equal(
      (await f.call(path, { method, body, admin: b.token })).status,
      403,
      path,
    );
  assert.equal(
    (await f.call("/admin/queues", { admin: b.token })).body.queues.length,
    1,
  );
  assert.equal((await f.call(`/admin/queues/${a.q}`)).status, 401);
});
test("QR expires at exactly 20 seconds; tampering and cross-queue reuse fail", async (t) => {
  const f = await fixture(t),
    a = await f.teacher("teacher_a"),
    code = await f.invite();
  assert.equal(code.intervalMs, 20_000);
  assert.equal(code.expiresAt - code.serverNow, 20_000);
  f.clock.value = code.expiresAt - 1;
  assert.equal((await f.redeem("legacy", visitor(), code.invite)).status, 200);
  f.clock.value = code.expiresAt;
  assert.equal((await f.redeem("legacy", visitor(), code.invite)).status, 410);
  const fresh = await f.invite();
  assert.notEqual(code.invite, fresh.invite);
  assert.equal((await f.redeem(a.q, visitor(), fresh.invite)).status, 400);
  assert.equal(
    (await f.redeem("legacy", visitor(), fresh.invite.slice(0, -2) + "xx"))
      .status,
    400,
  );
  assert.equal(
    (await f.call("/queues/legacy/invite", { token: visitor() })).status,
    403,
  );
  assert.equal(
    (
      await f.call("/join", {
        method: "POST",
        token: visitor(),
        body: { name: "X", studentGroup: "Y" },
      })
    ).status,
    410,
  );
});
test("one QR can be redeemed by many students, grants are visitor-bound", async (t) => {
  const f = await fixture(t),
    qr = await f.invite(),
    a = visitor(),
    b = visitor();
  const first = (await f.redeem("legacy", a, qr.invite)).body.admission,
    second = (await f.redeem("legacy", b, qr.invite)).body.admission;
  assert.notEqual(first.id, second.id);
  assert.equal(
    (
      await f.call("/queues/legacy/join", {
        method: "POST",
        token: b,
        body: { name: "A", studentGroup: "G", grantId: first.id },
      })
    ).status,
    410,
  );
  assert.equal(
    (await f.call("/queues/legacy", { token: a })).body.admission.id,
    first.id,
  );
});
test("form grant survives QR rotation; normal issuer completion does not revoke grant", async (t) => {
  const f = await fixture(t),
    a = visitor(),
    b = visitor();
  await f.enroll("legacy", a);
  const qr = (await f.call("/queues/legacy/invite", { token: a })).body;
  const redeemed = await f.redeem("legacy", b, qr.invite);
  const current = (
    await f.call("/admin/queues/legacy/next", {
      method: "POST",
      admin: f.owner,
    })
  ).body.current;
  await f.call(`/admin/queues/legacy/tickets/${current.id}/finish`, {
    method: "POST",
    admin: f.owner,
    body: { status: "done" },
  });
  assert.equal(
    (await f.call("/queues/legacy/invite", { token: a })).status,
    403,
  );
  f.clock.value += 60_000;
  const joined = await f.call("/queues/legacy/join", {
    method: "POST",
    token: b,
    body: { name: "B", studentGroup: "G", grantId: redeemed.body.admission.id },
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.mine.number, "A-002");
});
test("grant expiration is enforced and does not enroll", async (t) => {
  const f = await fixture(t),
    token = visitor(),
    code = await f.invite();
  const redeemed = await f.redeem("legacy", token, code.invite);
  f.clock.value = redeemed.body.admission.expiresAt;
  assert.equal(
    (
      await f.call("/queues/legacy/join", {
        method: "POST",
        token,
        body: {
          name: "X",
          studentGroup: "G",
          grantId: redeemed.body.admission.id,
        },
      })
    ).status,
    410,
  );
  assert.equal((await f.call("/queues/legacy", { token })).body.mine, null);
});
test("parallel joins are unique FIFO; grant replay after cancellation never creates a new ticket", async (t) => {
  const f = await fixture(t),
    qr = await f.invite();
  const results = await Promise.all(
    Array.from({ length: 20 }, () => f.enroll("legacy", visitor(), qr.invite)),
  );
  assert.equal(new Set(results.map((r) => r.body.mine.number)).size, 20);
  const token = visitor(),
    grant = (await f.redeem("legacy", token, qr.invite)).body.admission;
  const args = {
    method: "POST",
    token,
    body: { name: "X", studentGroup: "G", grantId: grant.id },
  };
  const duplicate = await Promise.all([
    f.call("/queues/legacy/join", args),
    f.call("/queues/legacy/join", args),
  ]);
  assert.equal(duplicate[0].body.mine.id, duplicate[1].body.mine.id);
  await f.call("/queues/legacy/leave", { method: "POST", token });
  f.clock.value += 200_000;
  const replay = await f.call("/queues/legacy/join", args);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.mine.status, "cancelled");
  assert.equal(replay.body.stats.total, 21);
  const calls = await Promise.all([
    f.call("/admin/queues/legacy/next", { method: "POST", admin: f.owner }),
    f.call("/admin/queues/legacy/next", { method: "POST", admin: f.owner }),
  ]);
  assert.deepEqual(calls.map((x) => x.status).sort(), [200, 409]);
});
test("reload with old QR restores the active ticket without requiring a new invite", async (t) => {
  const f = await fixture(t),
    token = visitor(),
    qr = await f.invite();
  const ticket = (await f.enroll("legacy", token, qr.invite)).body.mine;
  f.clock.value = qr.expiresAt + 100_000;
  const old = await f.redeem("legacy", token, qr.invite);
  assert.equal(old.status, 200);
  assert.equal(old.body.mine.id, ticket.id);
  assert.equal(
    (await f.call("/queues/legacy", { token })).body.mine.id,
    ticket.id,
  );
});
test("pause/capacity/new generation are checked on grant consumption and reset is scoped", async (t) => {
  const f = await fixture(t),
    a = await f.teacher("teacher_a"),
    token = visitor(),
    qr = await f.invite();
  const grant = (await f.redeem("legacy", token, qr.invite)).body.admission;
  await f.enroll(a.q, token);
  const args = {
    method: "POST",
    token,
    body: { name: "X", studentGroup: "G", grantId: grant.id },
  };
  await f.call("/admin/queues/legacy/settings", {
    method: "PATCH",
    admin: f.owner,
    body: { status: "paused" },
  });
  assert.equal((await f.call("/queues/legacy/join", args)).status, 409);
  await f.call("/admin/queues/legacy/settings", {
    method: "PATCH",
    admin: f.owner,
    body: { status: "open", maxQueue: 1 },
  });
  await f.enroll();
  assert.equal((await f.call("/queues/legacy/join", args)).status, 409);
  await f.call("/admin/queues/legacy/reset", {
    method: "POST",
    admin: f.owner,
    body: { confirmation: "НОВАЯ ПАРА", generation: 1 },
  });
  assert.equal((await f.call("/queues/legacy/join", args)).status, 410);
  assert.equal(
    (await f.call(`/queues/${a.q}`, { token })).body.mine.status,
    "waiting",
  );
  assert.equal(
    (
      await f.call("/admin/queues/legacy/reset", {
        method: "POST",
        admin: f.owner,
        body: { confirmation: "НОВАЯ ПАРА", generation: 1 },
      })
    ).status,
    409,
  );
});
test("public snapshots keep other students private and display tokens are read-only", async (t) => {
  const f = await fixture(t),
    token = visitor();
  await f.enroll("legacy", token);
  await f.call("/admin/queues/legacy/next", { method: "POST", admin: f.owner });
  const publicView = (await f.call("/queues/legacy")).body;
  assert.equal(publicView.mine, null);
  assert.deepEqual(Object.keys(publicView.current).sort(), [
    "calledAt",
    "number",
  ]);
  assert.ok(!JSON.stringify(publicView).includes("Тестовый"));
  const display = (
    await f.call("/admin/queues/legacy/display-session", {
      method: "POST",
      admin: f.owner,
    })
  ).body.token;
  assert.equal(
    (await f.call("/display/queues/legacy/invite", { display })).status,
    200,
  );
  assert.equal(
    (
      await f.call("/admin/queues/legacy/next", {
        method: "POST",
        admin: display,
      })
    ).status,
    401,
  );
  await f.call("/admin/queues/legacy/reset", {
    method: "POST",
    admin: f.owner,
    body: { confirmation: "НОВАЯ ПАРА", generation: 1 },
  });
  assert.equal(
    (await f.call("/display/queues/legacy/invite", { display })).status,
    401,
  );
});
test("disabled teacher cannot log in or issue invitations; existing tickets remain", async (t) => {
  const f = await fixture(t),
    a = await f.teacher("teacher_a"),
    token = visitor();
  await f.enroll(a.q, token);
  const qr = await f.invite(a.q, a.token);
  await f.call(`/admin/teachers/${a.user.id}`, {
    admin: f.owner,
    method: "PATCH",
    body: { active: false },
  });
  assert.equal((await f.call("/admin/me", { admin: a.token })).status, 401);
  assert.equal((await f.redeem(a.q, visitor(), qr.invite)).status, 409);
  assert.equal((await f.call(`/queues/${a.q}/invite`, { token })).status, 409);
  assert.equal(
    (await f.call(`/queues/${a.q}`, { token })).body.mine.status,
    "waiting",
  );
});
test("validation, exact CORS origins and owner privilege controls", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.call("/admin/teachers", {
        admin: f.owner,
        method: "POST",
        body: { name: "X", username: "bad login" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call("/admin/teachers", {
        admin: f.owner,
        method: "POST",
        body: { name: "X", username: "newowner", role: "owner" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call("/admin/queues/legacy/settings", {
        admin: f.owner,
        method: "PATCH",
        body: { generation: 22 },
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.call("/queues/legacy", { origin: "https://attacker.test" }))
      .status,
    403,
  );
  const cors = await f.call("/queues/legacy", {
    origin: "https://example.github.io",
  });
  assert.equal(
    cors.headers.get("Access-Control-Allow-Origin"),
    "https://example.github.io",
  );
  assert.equal(
    (
      await f.call("/queues/legacy/redeem", {
        method: "OPTIONS",
        origin: "https://example.github.io",
      })
    ).status,
    204,
  );
  const q = await f.call("/admin/queues", {
    admin: f.owner,
    method: "POST",
    body: { title: "Paused", room: "303", status: "paused" },
  });
  assert.equal(q.body.queue.status, "paused");
});
test("password reset and logout revoke administrative sessions", async (t) => {
  const f = await fixture(t),
    a = await f.teacher("teacher_a");
  const r = await f.call(`/admin/teachers/${a.user.id}`, {
    admin: f.owner,
    method: "PATCH",
    body: { resetPassword: true },
  });
  assert.equal((await f.call("/admin/me", { admin: a.token })).status, 401);
  const token = await f.login("teacher_a", r.body.password);
  assert.ok(token);
  await f.call("/admin/logout", { admin: token, method: "POST" });
  assert.equal((await f.call("/admin/me", { admin: token })).status, 401);
});
test("restart preserves accounts, grants, tickets and signing key, but not expired QR validity", async (t) => {
  const path = temporary(t),
    clock = { value: Date.parse("2026-10-01T12:00:00Z") },
    f = await fixture(t, { databasePath: path, clock }),
    token = visitor(),
    qr = await f.invite();
  const grant = (await f.redeem("legacy", token, qr.invite)).body.admission;
  const a = await f.teacher("teacher_a");
  await f.close();
  clock.value = qr.expiresAt + 1;
  const g = await fixture(t, { databasePath: path, clock });
  assert.equal((await g.redeem("legacy", visitor(), qr.invite)).status, 410);
  assert.equal((await g.call("/admin/me", { admin: a.token })).status, 200);
  assert.equal(
    (await g.call("/queues/legacy", { token })).body.admission.id,
    grant.id,
  );
  assert.equal(
    (
      await g.call("/queues/legacy/join", {
        method: "POST",
        token,
        body: { name: "X", studentGroup: "G", grantId: grant.id },
      })
    ).status,
    200,
  );
  await g.close();
  const h = await fixture(t, { databasePath: path, clock });
  assert.equal(
    (await h.call("/queues/legacy", { token })).body.mine.number,
    "A-001",
  );
  await h.close();
});
test("v1 migration preserves visitor ownership and is idempotent with a database backup", async (t) => {
  const path = temporary(t),
    token = visitor(),
    db = new DatabaseSync(path);
  db.exec(
    `CREATE TABLE settings(id INTEGER PRIMARY KEY,title TEXT,room TEXT,status TEXT,avgMinutes INTEGER,maxQueue INTEGER,generation INTEGER);INSERT INTO settings VALUES(1,'Старая пара','101','open',5,60,3);CREATE TABLE tickets(id TEXT PRIMARY KEY,generation INTEGER,seq INTEGER,number TEXT,visitorHash TEXT,name TEXT,studentGroup TEXT,status TEXT,createdAt TEXT,calledAt TEXT,finishedAt TEXT);CREATE TABLE sessions(tokenHash TEXT PRIMARY KEY,expiresAt INTEGER);`,
  );
  db.prepare("INSERT INTO tickets VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
    "old-ticket",
    3,
    5,
    "A-005",
    digest(token),
    "Старый студент",
    "G",
    "waiting",
    "2026-10-01T11:00:00Z",
    null,
    null,
  );
  db.close();
  const f = await fixture(t, { databasePath: path });
  assert.equal(
    (await f.call("/queues/legacy", { token })).body.mine.id,
    "old-ticket",
  );
  assert.ok(existsSync(`${path}.pre-v2.bak`));
  await f.close();
  const g = await fixture(t, { databasePath: path });
  assert.equal(
    g.store.db.prepare("SELECT COUNT(*) AS n FROM queue_tickets").get().n,
    1,
  );
  assert.equal(
    (await g.call("/me/tickets", { token })).body.tickets[0].number,
    "A-005",
  );
  await g.close();
});

test("ending a queue is confirmed, scoped, final and recoverable by students", async (t) => {
  const f = await fixture(t), a = await f.teacher("end_teacher"), b = await f.teacher("other_teacher");
  const first = visitor(), second = visitor(), pending = visitor();
  await f.enroll(a.q, first, (await f.invite(a.q, a.token)).invite);
  await f.enroll(a.q, second, (await f.invite(a.q, a.token)).invite);
  await f.call(`/admin/queues/${a.q}/next`, {admin:a.token,method:"POST"});
  const invite = (await f.invite(a.q,a.token)).invite;
  const grant = (await f.redeem(a.q,pending,invite)).body.admission.id;
  const display = (await f.call(`/admin/queues/${a.q}/display-session`,{admin:a.token,method:"POST"})).body.token;
  const path = `/admin/queues/${a.q}/end`, body = {confirmation:"ЗАВЕРШИТЬ",generation:1};
  assert.equal((await f.call(path,{admin:b.token,method:"POST",body})).status,403);
  assert.equal((await f.call(path,{admin:a.token,method:"POST",body:{generation:1}})).status,400);
  assert.equal((await f.call(path,{admin:a.token,method:"POST",body:{...body,generation:2}})).status,409);
  assert.equal((await f.call(`/queues/${a.q}`,{token:first})).body.mine.status,"called");
  const results = await Promise.all([f.call(path,{admin:a.token,method:"POST",body}), f.call(path,{admin:a.token,method:"POST",body})]);
  results.forEach(result=>assert.equal(result.status,200));
  for (const token of [first,second]) {
    const result = (await f.call(`/queues/${a.q}`,{token})).body;
    assert.ok(result.settings.endedAt); assert.equal(result.mine.status,"cancelled");
    assert.equal(result.current,null); assert.equal(result.stats.waiting,0); assert.equal(result.canShare,false);
    assert.ok((await f.call('/me/tickets',{token})).body.tickets[0].queue.endedAt);
  }
  assert.equal((await f.call('/admin/queues',{admin:a.token})).body.queues.length,0);
  assert.equal((await f.call('/admin/queues',{admin:b.token})).body.queues[0].id,b.q);
  assert.equal((await f.call(`/admin/queues/${a.q}/settings`,{admin:a.token,method:"PATCH",body:{status:"open"}})).status,410);
  assert.equal((await f.call(`/admin/queues/${a.q}/reset`,{admin:a.token,method:"POST",body:{confirmation:"НОВАЯ ПАРА",generation:1}})).status,410);
  assert.equal((await f.call(`/admin/queues/${a.q}/next`,{admin:a.token,method:"POST"})).status,410);
  assert.equal((await f.call(`/admin/queues/${a.q}/invite`,{admin:a.token})).status,410);
  assert.equal((await f.call(`/display/queues/${a.q}/invite`,{display})).status,410);
  assert.equal((await f.redeem(a.q,visitor(),invite)).status,410);
  assert.equal((await f.call(`/queues/${a.q}/join`,{token:pending,method:"POST",body:{name:"Late",grantId:grant}})).status,410);
  assert.equal((await f.call(`/queues/${a.q}`,{token:pending})).body.admission,null);
});
