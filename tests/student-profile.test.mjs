import test from "node:test";
import assert from "node:assert/strict";
import { studentDraft, rememberStudentName, savedStudentName } from "../src/student-profile.mjs";

function memoryStorage() {
  const data = new Map();
  return { get: (key) => data.get(key) ?? null, set: (key, value) => { data.set(key, value); return true; } };
}

test("name survives new queues, new sessions and edits", () => {
  const storage = memoryStorage();
  rememberStudentName(storage, "Алина Ким");
  assert.equal(studentDraft(storage, "teacher-one").name, "Алина Ким");
  assert.equal(studentDraft(storage, "teacher-two").name, "Алина Ким");
  rememberStudentName(storage, "Алина Иванова");
  assert.equal(studentDraft(storage, "teacher-one").name, "Алина Иванова");
  rememberStudentName(storage, "");
  assert.equal(studentDraft(storage, "teacher-two").name, "");
});

test("old queue drafts migrate to reusable profile without group data", () => {
  const storage = memoryStorage();
  storage.set("campus.draft.v2.old", JSON.stringify({ name: "Студент", studentGroup: "old" }));
  assert.deepEqual(studentDraft(storage, "old"), { name: "Студент" });
  assert.deepEqual(studentDraft(storage, "another"), { name: "Студент" });
  rememberStudentName(storage, "Новое имя");
  assert.equal(studentDraft(storage, "old").name, "Новое имя");
});

test("invalid or unavailable storage leaves an editable empty form", () => {
  for (const bad of [null, "broken", "null", '{"name":3}', "[]"]) {
    const storage = { get: () => bad, set: () => false };
    assert.equal(savedStudentName(storage), null);
    assert.deepEqual(studentDraft(storage, "queue"), { name: "" });
  }
  const storage = { get: () => null, set: () => false };
  assert.equal(rememberStudentName(storage, "Имя"), false);
});
