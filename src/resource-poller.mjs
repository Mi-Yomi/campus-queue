// One request at a time; explicit refreshes during a request share one follow-up.
export function createResourcePoller({ load, online, visible, onOffline, interval,
  schedule = setTimeout, cancel = clearTimeout }) {
  let active = true, timer, flight, queued, failures = 0;
  function clear() { cancel(timer); timer = undefined; }
  function later(delay) {
    clear();
    if (active && online() && visible() && delay > 0)
      timer = schedule(() => { timer = undefined; void refresh(); }, delay);
  }
  function refresh() {
    if (!active) return Promise.resolve(null);
    clear();
    if (!online()) { onOffline(); return Promise.resolve(null); }
    if (!visible()) return Promise.resolve(null);
    if (flight) {
      queued ||= flight.then(() => { queued = null; return refresh(); });
      return queued;
    }
    flight = (async () => {
      // Defer only the completion bookkeeping, never the fetch itself.
      const result = await load();
      failures = result ? 0 : failures + 1;
      return result;
    })().finally(() => {
      flight = null;
      const normal = interval();
      later(failures && normal ? [2000, 5000, 10000, 15000, 30000][Math.min(failures - 1, 4)] : normal);
    });
    return flight;
  }
  return {
    refresh,
    offline() { clear(); if (active) onOffline(); },
    stop() { active = false; clear(); },
  };
}
