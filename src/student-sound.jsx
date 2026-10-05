import React, { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { storage } from "./api";
import { createCallSound } from "./call-sound.mjs";
import { createChimePlayer } from "./chime-player.mjs";
import { studentMedia } from "./student-ui";

export function useStudentSound(callKey) {
  const [audio] = useState(() => createChimePlayer({ url: studentMedia("call-chime.wav") }));
  const [state, setState] = useState({ enabled: false, busy: false, error: "" });
  const [control] = useState(() => createCallSound({ media: () => audio, storage, changed: setState }));
  useEffect(() => { control.update(callKey ? [callKey] : []); }, [control, callKey]);
  useEffect(() => () => control.dispose(), [control]);
  return { control, ...state };
}

export function StudentSound({ sound }) {
  return <div className="student-sound-row">
    <button type="button" aria-pressed={sound.enabled} disabled={sound.busy}
      onClick={sound.enabled ? sound.control.disable : sound.control.enable}>
      {sound.enabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
      {sound.busy ? "Подождите…" : sound.enabled ? "Звук включён" : "Включить звук"}
    </button>
    {sound.enabled && <button type="button" className="student-sound-preview" disabled={sound.busy}
      onClick={sound.control.preview}>Послушать</button>}
    <p>{sound.enabled ? "При вызове прозвучит короткий сигнал." : "Включите звук, чтобы услышать свой вызов."}</p>
    <p>Оставьте страницу открытой и экран включённым.</p>
    {sound.error && <p className="field-error" role="status">{sound.error}</p>}
  </div>;
}
