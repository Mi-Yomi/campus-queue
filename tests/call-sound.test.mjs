import test from "node:test";
import assert from "node:assert/strict";
import { createCallSound } from "../src/call-sound.mjs";

function fixture({ play = () => Promise.resolve(), unlock = () => Promise.resolve() } = {}) {
  const saved = new Map();
  const audio = { count: 0, unlocks: 0, pauses: 0,
    play() { this.count++; return play(); },
    unlock() { this.unlocks++; return unlock(); },
    pause() { this.pauses++; }, dispose() { this.pause(); },
  };
  let state;
  const control = createCallSound({ media: () => audio,
    storage: { get: key => saved.get(key), set: (key, value) => saved.set(key, value) },
    changed: next => { state = next; },
  });
  return { control, audio, saved, state: () => state };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("join enables silently; only a real call rings, once across snapshots", async () => {
  const f = fixture();
  f.control.enableOnJoin(); await tick();
  assert.equal(f.state().enabled, true); assert.equal(f.audio.unlocks, 1); assert.equal(f.audio.count, 0);
  f.control.update([]); await tick(); assert.equal(f.audio.count, 0);
  f.control.update(["first:calledAt"]); await tick();
  f.control.update(["first:calledAt"]); await tick();
  assert.equal(f.audio.count, 1);
  f.control.update([]); f.control.update(["second:calledAt"]); await tick();
  assert.equal(f.audio.count, 2);
});
test("muting is remembered and blocks automatic enable on next join", async () => {
  const f = fixture(); await f.control.enable();
  f.control.disable(); f.control.update(["ticket"]); f.control.enableOnJoin(); await tick();
  assert.equal(f.audio.count, 0); assert.equal(f.audio.unlocks, 1); assert.equal(f.state().enabled, false);
});
test("blocked playback is not claimed successful or marked heard; enabling retries", async () => {
  let blocked = true;
  const f = fixture({unlock: () => blocked ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve()});
  f.control.update(["ticket"]); await f.control.enable();
  assert.equal(f.state().enabled, false); assert.ok(f.state().error);
  assert.equal(f.saved.get("ritm.call-heard.v1.ticket"), undefined);
  blocked = false; await f.control.enable();
  assert.equal(f.state().enabled, true);
  f.control.update(["ticket"]); await tick(); assert.equal(f.audio.count, 1);
});
test("mute or unmount while play is pending cannot re-enable sound", async () => {
  for (const action of ["disable", "dispose"]) {
    let resolve;
    const f = fixture({unlock: () => new Promise(r => { resolve = r; })});
    const pending = f.control.enable(); f.control[action](); resolve(); await pending;
    assert.notEqual(f.saved.get("ritm.call-sound.v1"), "on");
    assert.equal(f.audio.pauses, 1);
  }
});
test("call arriving during silent preparation is not missed", async () => {
  let resolve;
  const f = fixture({unlock: () => new Promise(r => { resolve = r; })});
  const pending = f.control.enable(); f.control.update(["arrived"]); resolve(); await pending; await tick();
  assert.equal(f.audio.count, 1); assert.equal(f.saved.get("ritm.call-heard.v1.arrived"), "1");
});
test("sound preview is explicit and does not consume a future call", async () => {
  const f=fixture(); await f.control.enable(); assert.equal(f.audio.count,0);
  await f.control.preview(); assert.equal(f.audio.count,1);
  f.control.update(["later"]); await tick(); assert.equal(f.audio.count,2);
});
test("failed real-call playback stays retryable", async () => {
  let blocked=true;
  const f=fixture({play:()=>blocked?Promise.reject(new Error("Interrupted")):Promise.resolve()});
  await f.control.enable(); f.control.update(["ticket"]); await tick();
  assert.equal(f.state().enabled,false); assert.equal(f.saved.get("ritm.call-heard.v1.ticket"),undefined);
  blocked=false; await f.control.enable(); await tick();
  assert.equal(f.audio.count,2); assert.equal(f.saved.get("ritm.call-heard.v1.ticket"),"1");
});
