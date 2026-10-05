import test from "node:test";
import assert from "node:assert/strict";
import { createChimePlayer } from "../src/chime-player.mjs";

function fixture() {
  let starts=0, stops=0, loads=0;
  const events=[];
  const context={state:"suspended", destination:{},
    resume(){events.push("resume");this.state="running";return Promise.resolve();},
    decodeAudioData(){return Promise.resolve({duration:1.25});},
    createBufferSource(){return {connect(){},disconnect(){},start(){starts++;},stop(){stops++;}};},
    close(){this.state="closed";return Promise.resolve();},
  };
  const player=createChimePlayer({url:"/call.wav",createContext:()=>context,
    fetchAudio:async()=>{events.push("load");loads++;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};},
  });
  return {player,context,events,starts:()=>starts,stops:()=>stops,loads:()=>loads};
}
test("unlock resumes before loading and never starts an audible source",async()=>{
  const f=fixture();await f.player.unlock();
  assert.deepEqual(f.events,["resume","load"]);assert.equal(f.starts(),0);
  await f.player.play();assert.equal(f.starts(),1);assert.equal(f.loads(),1);
  f.player.dispose();assert.equal(f.stops(),1);assert.equal(f.context.state,"closed");
});
test("muting during asynchronous preparation prevents late playback",async()=>{
  const f=fixture();const pending=f.player.play();f.player.pause();
  await assert.rejects(pending,/cancelled/);assert.equal(f.starts(),0);
});
test("closing the view while audio loads cannot play after unmount",async()=>{
  const f=fixture();const pending=f.player.play();f.player.dispose();
  await assert.rejects(pending);assert.equal(f.starts(),0);assert.equal(f.context.state,"closed");
});
