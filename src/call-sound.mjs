// Keep playback permission separate from the saved preference: reload may revoke it.
export function createCallSound({ media, storage, changed }) {
  let enabled = false, version = 0, pending = false;
  let calls = [];
  const heard = new Set();
  const heardKey = key => `ritm.call-heard.v1.${key}`;
  const remember = keys => keys.forEach(key => {
    heard.add(key);
    storage.set(heardKey(key), "1", true);
  });
  const unplayed = () => calls.filter(key => !heard.has(key) && !storage.get(heardKey(key), true));
  async function play({ enable = false, audible = true } = {}) {
    if (pending) return;
    const operation = ++version;
    const announced = [...calls];
    pending = true;
    changed({ enabled, busy: true, error: "" });
    try {
      const audio = media();
      if (audible) await audio.play();
      else await audio.unlock();
      if (operation !== version) return;
      if (enable) {
        enabled = true;
        storage.set("ritm.call-sound.v1", "on");
      }
      if (audible) remember(announced);
      changed({ enabled, busy: false, error: "" });
    } catch {
      if (operation !== version) return;
      enabled = false;
      changed({ enabled: false, busy: false, error: "Нажмите «Включить звук» и проверьте громкость телефона." });
    } finally {
      if (operation === version) {
        pending = false;
        // A call may have arrived while silent unlocking was pending.
        if (enabled && unplayed().length) void play();
      }
    }
  }
  return {
    enable: () => play({ enable: true, audible: false }),
    enableOnJoin() {
      if (storage.get("ritm.call-sound.v1") !== "off") void play({ enable: true, audible: false });
    },
    disable() {
      version++;
      pending = false;
      enabled = false;
      media()?.pause();
      storage.set("ritm.call-sound.v1", "off");
      changed({ enabled: false, busy: false, error: "" });
    },
    preview: () => play({ enable: true }),
    update(nextCalls) {
      calls = nextCalls;
      if (enabled && unplayed().length) void play();
    },
    dispose() { version++; pending = false; enabled = false; media()?.dispose(); },
  };
}
