const key = "campus.student-profile.v1";

export function savedStudentName(storage) {
  try {
    const profile = JSON.parse(storage.get(key));
    return typeof profile?.name === "string" ? profile.name.slice(0, 60) : null;
  } catch {
    return null;
  }
}

export function rememberStudentName(storage, name) {
  return storage.set(key, JSON.stringify({ name: name.slice(0, 60) }));
}

export function studentDraft(storage, queueId) {
  const saved = savedStudentName(storage);
  if (saved !== null) return { name: saved };
  try {
    const draft = JSON.parse(storage.get(`campus.draft.v2.${queueId}`));
    const name = typeof draft?.name === "string" ? draft.name.slice(0, 60) : "";
    if (name) rememberStudentName(storage, name);
    return { name };
  } catch {
    return { name: "" };
  }
}
