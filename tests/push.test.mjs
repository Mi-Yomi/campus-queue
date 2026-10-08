import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createECDH, randomBytes } from "node:crypto";
import webpush from "web-push";
import { validPushEndpoint, validateSubscription, deliveryResult } from "../supabase/functions/_shared/push-validation.mjs";
import { pushDevice, appDirectory, normalizedTransferCode } from "../src/push-device.mjs";
import { readVisitor, visitorCookie } from "../src/visitor-identity.mjs";

test("iOS gets installation instructions, Android goes directly to permission", () => {
  assert.equal(pushDevice({ userAgent: "Mozilla iPhone Safari" }).needsInstall, true);
  assert.equal(pushDevice({ userAgent: "iPhone CriOS/140" }).needsInstall, true);
  assert.equal(pushDevice({ userAgent: "iPhone", standalone: true }).needsInstall, false);
  assert.equal(pushDevice({ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 }).ios, true);
  assert.equal(pushDevice({ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 0 }).ios, false);
  assert.deepEqual(pushDevice({ userAgent: "Android Chrome" }), { ios: false, android: true, needsInstall: false, standalone: false });
});
test("worker and cookie stay inside the queue project, identity survives iOS cookie transfer", () => {
  const href = "https://mi-yomi.github.io/campus-queue/#/q/abc?invite=private";
  assert.equal(appDirectory(href).href, "https://mi-yomi.github.io/campus-queue/");
  assert.equal(appDirectory("https://mi-yomi.github.io/campus-queue/index.html#/q/a").pathname, "/campus-queue/");
  const original = "a".repeat(64), newer = "b".repeat(64);
  assert.equal(readVisitor({ get: () => null }, `unrelated=1; ritm.visitor.v1=${original}`), original);
  assert.equal(readVisitor({ get: () => newer }, `ritm.visitor.v1=${original}`), newer);
  assert.equal(readVisitor({ get: () => null }, "ritm.visitor.v1=invalid"), null);
  assert.match(visitorCookie(original, href), /Path=\/campus-queue\/;.*SameSite=Lax; Secure$/);
  assert.equal(normalizedTransferCode("abcd 1234-efab 5678"), "ABCD1234EFAB5678");
});
test("subscription validation rejects SSRF, malformed keys and fake P-256 points", async () => {
  for (const endpoint of ["http://fcm.googleapis.com/fcm/send/a", "https://localhost/push", "https://127.0.0.1/push",
    "https://fcm.googleapis.com.evil.org/fcm/send/a", "https://u:p@web.push.apple.com/a", "https://web.push.apple.com:8443/a",
    "https://fcm.googleapis.com/other/a", "https://web.push.apple.com/a#fragment"])
    assert.equal(validPushEndpoint(endpoint), false, endpoint);
  for (const endpoint of ["https://fcm.googleapis.com/fcm/send/a", "https://web.push.apple.com/a", "https://updates.push.services.mozilla.com/wpush/v2/a"])
    assert.equal(validPushEndpoint(endpoint), true);
  const pair = createECDH("prime256v1"); pair.generateKeys();
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: pair.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
  assert.deepEqual(await validateSubscription(subscription), subscription);
  await assert.rejects(validateSubscription({ ...subscription, keys: { ...subscription.keys, p256dh: Buffer.alloc(65).toString("base64url") } }));
  await assert.rejects(validateSubscription({ ...subscription, keys: { ...subscription.keys, auth: "small" } }));
  const keys = webpush.generateVAPIDKeys();
  const details = webpush.generateRequestDetails(subscription, "РИТМ — ваша очередь!", { TTL: 60, urgency: "high", vapidDetails: { subject: "https://mi-yomi.github.io/campus-queue/", ...keys } });
  assert.equal(details.headers["Content-Encoding"], "aes128gcm");
  assert.match(details.headers.Authorization, /^vapid t=/);
  assert.equal(details.body.includes(Buffer.from("РИТМ")), false, "Payload is encrypted");
  assert.deepEqual([201, 404, 410, 429, 503, 0, 403].map(deliveryResult), ["sent", "gone", "gone", "retry", "retry", "retry", "failed"]);
});

function workerContext(windows = []) {
  const handlers = {}, notifications = [], opened = [];
  const self = { registration: { scope: "https://mi-yomi.github.io/campus-queue/", showNotification: async (...args) => notifications.push(args) },
    clients: { matchAll: async () => windows, openWindow: async url => opened.push(url) },
    addEventListener: (name, fn) => { handlers[name] = fn; } };
  vm.runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), { self, URL, Date });
  return { handlers, notifications, opened };
}
test("push worker shows a call notification with the mascot and stable deduplication tag", async () => {
  const { handlers, notifications } = workerContext();
  let promise;
  handlers.push({ data: { json: () => ({ queueId: "q1", tag: "ritm-t1", body: "A-001 · Лаба", expiresAt: Date.now() + 60000 }) }, waitUntil: p => { promise = p; } });
  await promise;
  assert.equal(notifications[0][0], "РИТМ — ваша очередь!");
  assert.equal(notifications[0][1].tag, "ritm-t1");
  assert.equal(notifications[0][1].data.url, "https://mi-yomi.github.io/campus-queue/#/q/q1");
  assert.match(notifications[0][1].icon, /campus-queue\/brand\//);
  assert.equal(handlers.fetch, undefined, "No caching or interception of other apps");
});
test("notification click never navigates a cinema/other-project window", async () => {
  let touched = false, pending;
  const w = workerContext([{ url: "https://mi-yomi.github.io/", navigate: () => { touched = true; } }]);
  w.handlers.notificationclick({ notification: { close() {}, data: { url: "https://mi-yomi.github.io/campus-queue/#/q/q1" } }, waitUntil: p => { pending = p; } });
  await pending;
  assert.equal(touched, false);
  assert.equal(w.opened[0], "https://mi-yomi.github.io/campus-queue/#/q/q1");
});
test("delayed push does not falsely claim it is still the student's turn", async () => {
  const w = workerContext(); let pending;
  w.handlers.push({ data: { json: () => ({ expiresAt: Date.now() - 1000, body: "stale call" }) }, waitUntil: p => { pending = p; } });
  await pending;
  assert.equal(w.notifications[0][0], "РИТМ — проверьте талон");
  assert.notEqual(w.notifications[0][1].body, "stale call");
});
