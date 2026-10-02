export function serviceSeconds(ticket) {
  if (ticket?.status !== "done" || !ticket.calledAt || !ticket.finishedAt) return null;
  const seconds = (Date.parse(ticket.finishedAt) - Date.parse(ticket.calledAt)) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

// Callers pass only the current queue generation. Skips/cancellations and
// time between students must never become samples of actual service time.
export function serviceAnalytics(tickets) {
  const samples = tickets.map(serviceSeconds).filter(value => value !== null);
  const totalSeconds = samples.reduce((sum, value) => sum + value, 0);
  return { sampleCount: samples.length, totalSeconds,
    averageSeconds: samples.length ? totalSeconds / samples.length : null };
}

export function estimateMinutes(ahead, analytics) {
  if (ahead <= 0) return 0;
  const average = analytics?.averageSeconds;
  return analytics?.sampleCount > 0 && Number.isFinite(average) && average > 0
    ? Math.ceil(ahead * average / 60) : null;
}

export function durationLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} с`;
  return `${(seconds / 60).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} мин`;
}
