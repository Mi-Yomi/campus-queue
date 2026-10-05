import { estimateMinutes } from "./queue-analytics.mjs";
// Realtime carries numbers and statuses only. Personal data comes from the API.
export function applyLiveSnapshot(data, live) {
  if (!data || !live || data.settings.id !== live.settings.id || live.revision <= data.revision) return data;
  const { states = [], ...publicData } = live;
  let mine = data.mine;
  if (mine) {
    const previousSession = mine.generation !== live.settings.generation;
    const current = previousSession ? null : states.find(t => t.seq === mine.seq);
    const waiting = states.filter(t => t.status === "waiting");
    const position = current?.status === "waiting" ? waiting.findIndex(t => t.seq === mine.seq) + 1 : 0;
    const ahead = position ? position - 1 + Number(!!live.current) : 0;
    mine = { ...mine, ...current, previousSession, position, ahead,
      estimatedMinutes: estimateMinutes(ahead, live.analytics),
      ...(previousSession && ["waiting", "called"].includes(mine.status) ? { status: "cancelled" } : {}),
    };
  }
  const admission = !live.settings.endedAt && data.admission?.generation === live.settings.generation && live.settings.teacherActive
    ? data.admission : null;
  const canShare = !!(mine && !mine.previousSession && ["waiting", "called"].includes(mine.status)
    && live.settings.status === "open" && live.settings.teacherActive);
  // Names stay in participant-only API responses; public events update their order/status.
  const canSeeRoster = mine && !mine.previousSession && ["waiting", "called"].includes(mine.status)
    && !live.settings.endedAt && live.settings.teacherActive;
  const knownNames = new Map((data.roster || []).map(t => [t.seq, t.name]));
  const roster = canSeeRoster ? states.filter(t => ["waiting", "called"].includes(t.status))
    .map(t => ({ seq: t.seq, number: t.number, status: t.status,
      name: t.seq === mine.seq ? mine.name : knownNames.get(t.seq) || null })) : [];
  return { ...data, ...publicData, mine, admission, canShare, roster,
    rosterNeedsRefresh: !!canSeeRoster && roster.some(t => !t.name) };
}
