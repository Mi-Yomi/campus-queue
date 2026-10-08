import test from "node:test";
import assert from "node:assert/strict";
import { applyLiveSnapshot } from "../src/live-state.mjs";
const settings = { id: "q", generation: 1, avgMinutes: 99, status: "open", teacherActive: true };
const data = () => ({ settings, revision: 1, mine: { id: "private", name: "Student", generation: 1, seq: 2, status: "waiting" }, admission: { id: "grant", generation: 1 } });
const live = (extra = {}) => ({ settings, revision: 2, analytics: { sampleCount: 1, averageSeconds: 300 }, current: { number: "A-001" }, states: [{ seq: 1, status: "called" }, { seq: 2, status: "waiting" }], ...extra });

test("ending arrives over Realtime, clears admission and survives older events", () => {
 const endedAt = "2026-10-05T04:00:00Z";
 const next = applyLiveSnapshot(data(), live({settings: {...settings, status: "closed", endedAt}, current: null, states: [{seq:2,status:"cancelled"}]}));
 assert.equal(next.settings.endedAt, endedAt);
 assert.equal(next.mine.status, "cancelled"); assert.equal(next.mine.name, "Student");
 assert.equal(next.canShare, false); assert.equal(next.admission, null);
 assert.equal(applyLiveSnapshot(next, live({revision:1})),next);
});
test("public updates preserve private identity and calculate position", () => {
 const next = applyLiveSnapshot(data(), live());
 assert.equal(next.mine.id, "private"); assert.equal(next.mine.name, "Student");
 assert.equal(next.mine.position, 1); assert.equal(next.mine.ahead, 1);
 assert.equal(next.mine.estimatedMinutes, 5); assert.equal(next.canShare, true);
 assert.equal(next.admission.id, "grant"); assert.equal(next.states, undefined);
});

test("Realtime follows teacher order rather than ticket numbers and updates the estimate", () => {
 const initial = {...data(), roster: [{seq:1,name:"First"},{seq:2,name:"Student"},{seq:3,name:"Third"}]};
 const next = applyLiveSnapshot(initial, live({ states: [
   {seq:1,number:"A-001",status:"called",queueOrder:1},
   {seq:3,number:"A-003",status:"waiting",queueOrder:1},
   {seq:2,number:"A-002",status:"waiting",queueOrder:2},
 ] }));
 assert.equal(next.mine.number, "A-002"); assert.equal(next.mine.position, 2);
 assert.equal(next.mine.ahead, 2); assert.equal(next.mine.estimatedMinutes, 10);
 assert.deepEqual(next.roster.map(t=>t.name), ["First","Third","Student"]);
 assert.equal(next.rosterNeedsRefresh, false);
});
test("called and completed tickets update without private API reads", () => {
 const called = applyLiveSnapshot(data(), live({ states: [{ seq: 2, status: "called" }] }));
 assert.equal(called.mine.status, "called"); assert.equal(called.mine.position, 0);
 const done = applyLiveSnapshot(called, live({ revision: 3, states: [{ seq: 2, status: "done" }] }));
 assert.equal(done.mine.status, "done"); assert.equal(done.canShare, false);
});
test("Realtime uses measured averages and never the legacy manual time", () => {
 const pending = applyLiveSnapshot(data(), live({ analytics: { sampleCount: 0, averageSeconds: null } }));
 assert.equal(pending.mine.estimatedMinutes, null);
 const measured = applyLiveSnapshot(pending, live({ revision: 3, analytics: { sampleCount: 2, averageSeconds: 360 } }));
 assert.equal(measured.mine.estimatedMinutes, 6);
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
test("Realtime preserves roster names, removes finished people and fetches new names privately", () => {
 const initial = {...data(), roster:[{seq:1,number:"A-001",name:"First",status:"waiting"},{seq:2,number:"A-002",name:"Student",status:"waiting"}]};
 const next = applyLiveSnapshot(initial, live({states:[{seq:1,number:"A-001",status:"called"},{seq:2,number:"A-002",status:"waiting"},{seq:3,number:"A-003",status:"waiting"}]}));
 assert.deepEqual(next.roster.map(t=>t.name), ["First","Student",null]);
 assert.equal(next.roster[0].status,"called"); assert.equal(next.rosterNeedsRefresh,true);
 const finished = applyLiveSnapshot(next,live({revision:3,states:[{seq:1,status:"done"},{seq:2,number:"A-002",status:"called"},{seq:3,status:"cancelled"}]}));
 assert.deepEqual(finished.roster.map(t=>t.seq),[2]); assert.equal(finished.rosterNeedsRefresh,false);
 for (const update of [
   {states:[{seq:2,status:"done"}]},
   {states:[{seq:2,status:"cancelled"}]},
   {settings:{...settings,generation:2}},
   {settings:{...settings,endedAt:"2026-10-05T10:00:00Z"}},
   {settings:{...settings,teacherActive:false}},
 ]) {
   const cleared=applyLiveSnapshot(finished,live({...update,revision:4}));
   assert.deepEqual(cleared.roster,[]); assert.equal(cleared.rosterNeedsRefresh,false);
 }
});
