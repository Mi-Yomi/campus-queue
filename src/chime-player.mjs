// Unlock Web Audio in the user's click without playing any audible source.
export function createChimePlayer({ url,
  createContext = () => new (window.AudioContext || window.webkitAudioContext)(),
  fetchAudio = () => fetch(url, { signal: AbortSignal.timeout(8000) }),
}) {
  let context, decoded, source, disposed = false, version = 0;
  async function ready() {
    if (disposed) throw new Error("Audio disposed");
    context ||= createContext();
    // Call resume synchronously, before fetching/decoding loses user activation.
    const resumed = context.state === "running" ? Promise.resolve() : context.resume();
    decoded ||= fetchAudio().then(response => {
      if (!response.ok) throw new Error("Audio unavailable");
      return response.arrayBuffer();
    }).then(bytes => context.decodeAudioData(bytes)).catch(error => { decoded = null; throw error; });
    let timeout;
    try {
      const [, buffer] = await Promise.race([
        Promise.all([resumed, decoded]),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Audio permission timed out")), 8000); }),
      ]);
      if (disposed || context.state !== "running") throw new Error("Audio is not running");
      return buffer;
    } finally { clearTimeout(timeout); }
  }
  function pause() {
    version++;
    if (source) {
      source.stop();
      source.disconnect();
      source = null;
    }
  }
  return {
    unlock: ready,
    async play() {
      pause();
      const operation = version;
      const buffer = await ready();
      if (disposed || operation !== version) throw new Error("Playback cancelled");
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.connect(context.destination);
      node.onended = () => { node.disconnect(); if (source === node) source = null; };
      source = node;
      node.start();
    },
    pause,
    dispose() {
      disposed = true;
      pause();
      if (context && context.state !== "closed") void context.close().catch(() => {});
    },
  };
}
