import test from "node:test";
import assert from "node:assert/strict";
import { createCallSound } from "../src/call-sound.mjs";

function fixture(play = () => Promise.resolve()) {
  const saved = new Map();
  const audio = { count: 0, pauses: 0, play() { this.count++; return play(); }, pause() { this.pauses++; } };
  let state;
  const control = createCallSound({ media: () => audio,
    storage: { get: key => saved.get(key), set: (key, value) => saved.set(key, value) },
    changed: next => { state = next; },
  });
  return { control, audio, saved, state: () => state };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("join enables with a preview; each call rings only once across snapshots", async () => {
  const f = fixture();
  f.control.enableOnJoin(); await tick();
  assert.equal(f.state().enabled, true); assert.equal(f.audio.count, 1);
  f.control.update(["first:calledAt"]); await tick();
  f.control.update(["first:calledAt"]); await tick();
  assert.equal(f.audio.count, 2);
  f.control.update([]); f.control.update(["second:calledAt"]); await tick();
  assert.equal(f.audio.count, 3);
});
test("muting is remembered and blocks automatic enable on next join", async () => {
  const f = fixture(); await f.control.enable();
  f.control.disable(); f.control.update(["ticket"]); f.control.enableOnJoin(); await tick();
  assert.equal(f.audio.count, 1); assert.equal(f.state().enabled, false);
});
test("blocked playback is not claimed successful or marked heard; enabling retries", async () => {
  let blocked = true;
  const f = fixture(() => blocked ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve());
  f.control.update(["ticket"]); await f.control.enable();
  assert.equal(f.state().enabled, false); assert.ok(f.state().error);
  assert.equal(f.saved.get("ritm.call-heard.v1.ticket"), undefined);
  blocked = false; await f.control.enable();
  assert.equal(f.state().enabled, true);
  f.control.update(["ticket"]); await tick(); assert.equal(f.audio.count, 2);
});
test("mute or unmount while play is pending cannot re-enable sound", async () => {
  for (const action of ["disable", "dispose"]) {
    let resolve;
    const f = fixture(() => new Promise(r => { resolve = r; }));
    const pending = f.control.enable(); f.control[action](); resolve(); await pending;
    assert.notEqual(f.saved.get("ritm.call-sound.v1"), "on");
    assert.equal(f.audio.pauses, 1);
  }
});
test("call arriving during permission preview is not missed", async () => {
  let resolve;
  let first = true;
  const f = fixture(() => { if (first) { first = false; return new Promise(r => { resolve = r; }); } return Promise.resolve(); });
  const pending = f.control.enable(); f.control.update(["arrived"]); resolve(); await pending; await tick();
  assert.equal(f.audio.count, 2); assert.equal(f.saved.get("ritm.call-heard.v1.arrived"), "1");
});
