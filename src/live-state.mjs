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
      estimatedMinutes: ahead * live.settings.avgMinutes,
      ...(previousSession && ["waiting", "called"].includes(mine.status) ? { status: "cancelled" } : {}),
    };
  }
  const admission = data.admission?.generation === live.settings.generation && live.settings.teacherActive
    ? data.admission : null;
  const canShare = !!(mine && !mine.previousSession && ["waiting", "called"].includes(mine.status)
    && live.settings.status === "open" && live.settings.teacherActive);
  return { ...data, ...publicData, mine, admission, canShare };
}
