import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
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
test("advance completes the displayed ticket, calls FIFO once and measures actual service time", async (t) => {
  const f = await fixture(t);
  const students = [visitor(), visitor(), visitor()];
  const tickets = [];
  for (const token of students) tickets.push((await f.enroll("legacy", token)).body.mine);
  await f.call("/admin/queues/legacy/next", {admin:f.owner,method:"POST"});
  f.clock.value += 7 * 60_000;
  const options = {admin:f.owner,method:"POST",body:{currentTicketId:tickets[0].id}};
  const results = await Promise.all([f.call("/admin/queues/legacy/next",options),f.call("/admin/queues/legacy/next",options)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200,409]);
  const state = (await f.call("/admin/queues/legacy",{admin:f.owner})).body;
  assert.equal(state.current.id,tickets[1].id);
  assert.equal(state.stats.completed,1);
  assert.equal(state.stats.waiting,1);
  assert.equal(state.analytics.averageSeconds,420);
  assert.equal((await f.call("/queues/legacy",{token:students[0]})).body.mine.status,"done");
  assert.equal((await f.call("/queues/legacy",{token:students[1]})).body.mine.status,"called");
  assert.equal((await f.call("/admin/queues/legacy/next",{...options,body:{currentTicketId:tickets[2].id}})).status,409);
  await f.call("/admin/queues/legacy/next",{...options,body:{currentTicketId:tickets[1].id}});
  const last=await f.call("/admin/queues/legacy/next",{...options,body:{currentTicketId:tickets[2].id}});
  assert.equal(last.status,200);
  assert.equal(last.body.current,null);
  assert.equal(last.body.stats.completed,3);
  assert.equal(last.body.settings.status,"open");
  assert.equal((await f.call("/admin/queues/legacy/next",{...options,body:{currentTicketId:tickets[2].id}})).status,409);
});
test("teacher changes password without the old password and without losing the current session or student tickets", async (t) => {
  const f = await fixture(t);
  const teacher = await f.teacher("password_teacher");
  assert.equal(teacher.user.passwordChangeSuggested, false);
  const otherSession = await f.login(teacher.user.username, teacher.password);
  const display = (await f.call(`/admin/queues/${teacher.q}/display-session`, { admin: teacher.token, method: "POST" })).body.token;
  const student = visitor();
  const ticket = await f.enroll(teacher.q, student, (await f.invite(teacher.q, teacher.token)).invite);
  const body = { newPassword: "my-new-teacher-password" };
  const change = await f.call("/admin/password", { admin: teacher.token, method: "POST", body });
  assert.equal(change.status, 200);
  assert.equal(change.body.user.passwordChangeSuggested, false);
  assert.equal("passwordHash" in change.body.user, false);
  assert.equal((await f.call("/admin/me", { admin: teacher.token })).status, 200);
  assert.equal((await f.call("/admin/me", { admin: otherSession })).status, 401);
  assert.equal((await f.call(`/display/queues/${teacher.q}/invite`, { display })).status, 401);
  assert.equal((await f.call("/admin/login", { method: "POST", body: { username: teacher.user.username, password: teacher.password } })).status, 401);
  assert.ok(await f.login(teacher.user.username, body.newPassword));
  const tickets = (await f.call("/me/tickets", { token: student })).body.tickets;
  assert.equal(tickets[0].id, ticket.body.mine.id);
  assert.equal(tickets[0].status, "waiting");
  assert.ok(await f.login());
  const reset = await f.call(`/admin/teachers/${teacher.user.id}`, { admin: f.owner, method: "PATCH", body: { resetPassword: true } });
  assert.equal(reset.body.user.passwordChangeSuggested, true);
  assert.equal((await f.call("/admin/me", { admin: teacher.token })).status, 401);
  const login = await f.call("/admin/login", { method: "POST", body: { username: teacher.user.username, password: reset.body.password } });
  assert.equal(login.body.user.passwordChangeSuggested, true);
});
test("password change rejects unauthenticated, unchanged and malformed requests", async (t) => {
  const f = await fixture(t);
  const teacher = await f.teacher("password_validation");
  const valid = { newPassword: "a-valid-new-password" };
  assert.equal((await f.call("/admin/password", { method: "POST", body: valid })).status, 401);
  for (const body of [
    { ...valid, newPassword: teacher.password },
    { ...valid, newPassword: "short" },
    { ...valid, newPassword: "long".repeat(40) },
    { ...valid, newPassword: " spaced-password " },
    { ...valid, newPassword: "line\nbreak" },
    { ...valid, userId: "owner" },
    { ...valid, _hash: "injected" },
  ]) {
    assert.equal((await f.call("/admin/password", { admin: teacher.token, method: "POST", body })).status, 400);
  }
  assert.equal((await f.call("/admin/me", { admin: teacher.token })).body.user.passwordChangeSuggested, false);
  assert.ok(await f.login(teacher.user.username, teacher.password));
});
test("issued and reset passwords must be replaced before any teacher actions", async (t) => {
  const f = await fixture(t);
  const created = (await f.call("/admin/teachers", {admin:f.owner,method:"POST",body:{username:"temporary_teacher",name:"Teacher"}})).body;
  let token = await f.login(created.user.username, created.password);
  assert.equal((await f.call("/admin/me",{admin:token})).body.user.passwordChangeSuggested,true);
  for (const [path,method,body] of [
    ["/admin/queues","GET"],
    ["/admin/queues","POST",{title:"Blocked",room:"302"}],
    ["/admin/network","GET"],
    ["/admin/teachers","GET"],
  ]) assert.equal((await f.call(path,{admin:token,method,body})).status,403);
  assert.equal((await f.call("/admin/password",{admin:token,method:"POST",body:{newPassword:created.password}})).status,400);
  assert.equal((await f.call("/admin/logout",{admin:token,method:"POST"})).status,200);
  token = await f.login(created.user.username,created.password);
  const changed=await f.call("/admin/password",{admin:token,method:"POST",body:{newPassword:"my-personal-password"}});
  assert.equal(changed.status,200);
  assert.equal(changed.body.user.passwordChangeSuggested,false);
  const q=(await f.call("/admin/queues",{admin:token,method:"POST",body:{title:"My class",room:"302"}})).body.queue.id;
  const reset=(await f.call(`/admin/teachers/${created.user.id}`,{admin:f.owner,method:"PATCH",body:{resetPassword:true}})).body;
  assert.equal((await f.call("/admin/password",{admin:token,method:"POST",body:{newPassword:"stale-session-password"}})).status,401);
  assert.equal((await f.call("/admin/login",{method:"POST",body:{username:created.user.username,password:"my-personal-password"}})).status,401);
  token=await f.login(created.user.username,reset.password);
  for (const [path,method,body] of [
    [`/admin/queues/${q}`,"GET"],
    [`/admin/queues/${q}/next`,"POST",{}],
    [`/admin/queues/${q}/invite`,"GET"],
    [`/admin/queues/${q}/display-session`,"POST",{}],
    [`/admin/queues/${q}/end`,"POST",{generation:1,confirmation:"ЗАВЕРШИТЬ"}],
  ]) assert.equal((await f.call(path,{admin:token,method,body})).status,403);
  assert.equal((await f.call("/admin/password",{admin:token,method:"POST",body:{newPassword:"my-recovered-password"}})).status,200);
  assert.equal((await f.call(`/admin/queues/${q}`,{admin:token})).status,200);
});
test("manual entries share FIFO with QR students and retry never creates a duplicate", async t => {
  const f = await fixture(t), student = visitor();
  await f.enroll("legacy", student);
  const path = "/admin/queues/legacy/tickets";
  const body = { name: "Студент без телефона", requestId: randomUUID(), generation: 1 };
  const results = await Promise.all(Array.from({length: 3}, () => f.call(path, {admin:f.owner,method:"POST",body})));
  results.forEach(r => { assert.equal(r.status, 200); assert.equal(r.body.ticket.number, "A-002"); });
  assert.equal(new Set(results.map(r => r.body.ticket.id)).size, 1);
  assert.equal(results[0].body.ticket.visitorHash, undefined);
  const roster = (await f.call("/queues/legacy", {token:student})).body.roster;
  assert.deepEqual(roster.map(t => t.name), ["Тестовый студент", body.name]);
  const anonymous = (await f.call("/queues/legacy", {token:visitor()})).body;
  assert.equal(anonymous.mine, null); assert.equal(anonymous.roster, undefined);
  let state = (await f.call("/admin/queues/legacy/next", {admin:f.owner,method:"POST"})).body;
  state = (await f.call("/admin/queues/legacy/next", {admin:f.owner,method:"POST",body:{currentTicketId:state.current.id}})).body;
  assert.equal(state.current.id, results[0].body.ticket.id);
  await f.call("/admin/queues/legacy/next", {admin:f.owner,method:"POST",body:{currentTicketId:state.current.id}});
  const retry = await f.call(path, {admin:f.owner,method:"POST",body});
  assert.equal(retry.body.ticket.status, "done");
  assert.equal((await f.call("/admin/queues/legacy", {admin:f.owner})).body.stats.total, 2);
});

test("manual entry enforces teacher ownership, temporary password, capacity and current class", async t => {
  const f = await fixture(t), a = await f.teacher("manual_a"), b = await f.teacher("manual_b");
  const path = `/admin/queues/${a.q}/tickets`;
  const body = { name: "Студент", requestId: randomUUID(), generation: 1 };
  const send = (admin=a.token, changes={}) => f.call(path, {admin,method:"POST",body:{...body,...changes}});
  assert.equal((await send()).status, 200);
  assert.equal((await f.call(path,{method:"POST",body})).status, 401);
  assert.equal((await send(b.token)).status, 403);
  assert.equal((await send(a.token,{requestId:"bad"})).status, 400);
  assert.equal((await send(a.token,{name:" "})).status, 400);
  assert.equal((await send(a.token,{name:"Изменённое имя"})).status, 409);
  await f.call(`/admin/queues/${a.q}/settings`,{admin:a.token,method:"PATCH",body:{maxQueue:1}});
  assert.equal((await send(a.token,{requestId:randomUUID()})).status, 409);
  assert.equal((await send()).status, 200); // a retry still works at capacity
  await f.call(`/admin/queues/${a.q}/settings`,{admin:a.token,method:"PATCH",body:{status:"paused",maxQueue:10}});
  assert.equal((await send(a.token,{requestId:randomUUID()})).status, 409);
  await f.call(`/admin/queues/${a.q}/reset`,{admin:a.token,method:"POST",body:{confirmation:"НОВАЯ ПАРА",generation:1}});
  assert.equal((await send()).status, 409);
  assert.equal((await send(a.token,{generation:2,requestId:randomUUID()})).status, 200);
  await f.call(`/admin/queues/${a.q}/end`,{admin:a.token,method:"POST",body:{confirmation:"ЗАВЕРШИТЬ",generation:2}});
  assert.equal((await send(a.token,{generation:2,requestId:randomUUID()})).status, 410);
  const reset = await f.call(`/admin/teachers/${b.user.id}`,{admin:f.owner,method:"PATCH",body:{resetPassword:true}});
  const temp = await f.login("manual_b", reset.body.password);
  assert.equal((await f.call(`/admin/queues/${b.q}/tickets`,{admin:temp,method:"POST",body})).status,403);
});

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
    const personalPassword = `${name}-personal-password`;
    const changed = await call("/admin/password", {admin:token,method:"POST",body:{newPassword:personalPassword}});
    assert.equal(changed.status,200);
    const q = await call("/admin/queues", {
      method: "POST",
      admin: token,
      body: { title: `Пара ${name}` },
    });
    assert.equal(q.status, 201);
    assert.equal(q.body.queue.room, "");
    return { user: changed.body.user, token, q: q.body.queue.id, password: personalPassword };
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
test("roster is ordered, contains only active classmates and requires a current active ticket", async (t) => {
  const f = await fixture(t);
  const students = [visitor(), visitor(), visitor()];
  const tickets = [];
  for (const token of students) tickets.push((await f.enroll("legacy", token)).body.mine);
  await f.call("/admin/queues/legacy/next", { method: "POST", admin: f.owner });
  const state = (await f.call("/queues/legacy", {token:students[1]})).body;
  assert.deepEqual(state.roster.map(t => t.number), ["A-001", "A-002", "A-003"]);
  assert.deepEqual(state.roster.map(t => t.status), ["called", "waiting", "waiting"]);
  assert.deepEqual(Object.keys(state.roster[0]).sort(), ["name", "number", "seq", "status"]);
  assert.equal(state.roster[0].name, "Тестовый студент");
  assert.equal((await f.call("/queues/legacy", {token:visitor()})).body.roster, undefined);
  const another = await f.teacher("roster_other_class");
  assert.equal((await f.call(`/queues/${another.q}`, {token:students[1]})).body.roster, undefined);
  await f.call("/admin/queues/legacy/next", {method:"POST",admin:f.owner,body:{currentTicketId:tickets[0].id}});
  assert.equal((await f.call("/queues/legacy", {token:students[0]})).body.roster, undefined);
  await f.call("/queues/legacy/leave", {method:"POST",token:students[2]});
  assert.equal((await f.call("/queues/legacy", {token:students[2]})).body.roster, undefined);
  assert.deepEqual((await f.call("/queues/legacy", {token:students[1]})).body.roster.map(t=>t.number), ["A-002"]);
  await f.call("/admin/queues/legacy/reset", {method:"POST",admin:f.owner,body:{confirmation:"НОВАЯ ПАРА",generation:1}});
  assert.equal((await f.call("/queues/legacy", {token:students[1]})).body.roster, undefined);
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
