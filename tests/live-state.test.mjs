import test from "node:test";
import assert from "node:assert/strict";
import { applyLiveSnapshot } from "../src/live-state.mjs";
const settings = { id: "q", generation: 1, avgMinutes: 5, status: "open", teacherActive: true };
const data = () => ({ settings, revision: 1, mine: { id: "private", name: "Student", generation: 1, seq: 2, status: "waiting" }, admission: { id: "grant", generation: 1 } });
const live = (extra = {}) => ({ settings, revision: 2, current: { number: "A-001" }, states: [{ seq: 1, status: "called" }, { seq: 2, status: "waiting" }], ...extra });
test("public updates preserve private identity and calculate position", () => {
 const next = applyLiveSnapshot(data(), live());
 assert.equal(next.mine.id, "private"); assert.equal(next.mine.name, "Student");
 assert.equal(next.mine.position, 1); assert.equal(next.mine.ahead, 1);
 assert.equal(next.mine.estimatedMinutes, 5); assert.equal(next.canShare, true);
 assert.equal(next.admission.id, "grant"); assert.equal(next.states, undefined);
});
test("called and completed tickets update without private API reads", () => {
 const called = applyLiveSnapshot(data(), live({ states: [{ seq: 2, status: "called" }] }));
 assert.equal(called.mine.status, "called"); assert.equal(called.mine.position, 0);
 const done = applyLiveSnapshot(called, live({ revision: 3, states: [{ seq: 2, status: "done" }] }));
 assert.equal(done.mine.status, "done"); assert.equal(done.canShare, false);
});
test("new class cancels old active ticket and clears its admission", () => {
 const next = applyLiveSnapshot(data(), live({ settings: { ...settings, generation: 2 }, states: [{ seq: 2, status: "called" }] }));
 assert.equal(next.mine.previousSession, true); assert.equal(next.mine.status, "cancelled");
 assert.equal(next.admission, null); assert.equal(next.canShare, false);
});
test("old events and events from other queues cannot overwrite state", () => {
 const value = data();
 assert.equal(applyLiveSnapshot(value, live({ revision: 1 })), value);
 assert.equal(applyLiveSnapshot(value, live({ settings: { ...settings, id: "other" } })), value);
 assert.equal(applyLiveSnapshot(null, live()), null);
});
test("disabled teacher revokes sharing and pending admission", () => {
 const next = applyLiveSnapshot(data(), live({ settings: { ...settings, teacherActive: false } }));
 assert.equal(next.canShare, false); assert.equal(next.admission, null);
 assert.equal(next.mine.id, "private");
});
