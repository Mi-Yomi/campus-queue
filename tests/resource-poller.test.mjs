import test from "node:test";
import assert from "node:assert/strict";
import { createResourcePoller } from "../src/resource-poller.mjs";

function fixture() {
  const tasks = new Map(); let id = 0;
  const f = { connected: true, visible: true, calls: 0, offline: 0, result: {}, tasks };
  f.poller = createResourcePoller({ load: async () => { f.calls++; return f.result; },
    online: () => f.connected, visible: () => f.visible, onOffline: () => f.offline++, interval: () => 180000,
    schedule: (fn, ms) => { tasks.set(++id, { fn, ms }); return id; }, cancel: id => tasks.delete(id),
  });
  return f;
}
test("failed reads retry promptly, successful recovery restores the normal interval", async () => {
  const f = fixture(); f.result = null;
  await f.poller.refresh(); assert.equal([...f.tasks.values()][0].ms, 2000);
  await f.poller.refresh(); assert.equal([...f.tasks.values()][0].ms, 5000);
  f.result = { tickets: [] }; await f.poller.refresh();
  assert.equal([...f.tasks.values()][0].ms, 180000); assert.equal(f.tasks.size, 1);
  f.poller.stop(); assert.equal(f.tasks.size, 0);
});
test("offline is reported immediately, and coming online refreshes without waiting for polling", async () => {
  const f = fixture(); await f.poller.refresh();
  f.connected = false; f.poller.offline();
  assert.equal(f.offline, 1); assert.equal(f.tasks.size, 0);
  await f.poller.refresh(); assert.equal(f.calls, 1);
  f.connected = true; await f.poller.refresh(); assert.equal(f.calls, 2);
  f.poller.stop();
});
test("background tabs do not poll; returning refreshes and stopping cancels late follow-ups", async () => {
  const f = fixture(); f.visible = false;
  await f.poller.refresh(); assert.equal(f.calls, 0);
  f.visible = true; await f.poller.refresh(); assert.equal(f.calls, 1);
  f.poller.stop(); await f.poller.refresh(); assert.equal(f.calls, 1);
});
test("concurrent refreshes share one follow-up instead of aborting and starving requests", async () => {
  let finish, calls = 0;
  const sync = createResourcePoller({ load: () => ++calls === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({}),
    online: () => true, visible: () => true, onOffline() {}, interval: () => 0 });
  const first = sync.refresh(), second = sync.refresh(), third = sync.refresh();
  assert.equal(calls, 1); assert.equal(second, third);
  finish({}); await Promise.all([first, second, third]); assert.equal(calls, 2);
  sync.stop();
});
