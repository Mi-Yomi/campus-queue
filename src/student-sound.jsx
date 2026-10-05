import React, { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { storage } from "./api";
import { createCallSound } from "./call-sound.mjs";
import { studentMedia } from "./student-ui";

export function useStudentSound(callKey) {
  const audio = useRef(null);
  const [state, setState] = useState({ enabled: false, busy: false, error: "" });
  const [control] = useState(() => createCallSound({ media: () => audio.current, storage, changed: setState }));
  useEffect(() => { control.update(callKey ? [callKey] : []); }, [control, callKey]);
  useEffect(() => () => control.dispose(), [control]);
  return { audio, control, ...state };
}

export function StudentAudio({ sound }) {
  return <audio ref={sound.audio} src={studentMedia("call-chime.wav")} preload="auto" aria-hidden="true" />;
}

export function StudentSound({ sound }) {
  return <div className="student-sound-row">
    <button type="button" aria-pressed={sound.enabled} disabled={sound.busy}
      onClick={sound.enabled ? sound.control.disable : sound.control.enable}>
      {sound.enabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
      {sound.busy ? "Проверяем звук…" : sound.enabled ? "Звук включён" : "Включить звук"}
    </button>
    {sound.enabled && <button type="button" className="student-sound-preview" disabled={sound.busy}
      onClick={sound.control.preview}>Послушать</button>}
    <p>{sound.enabled ? "При вызове прозвучит короткий сигнал." : "Включите звук, чтобы услышать свой вызов."}</p>
    <p>Оставьте страницу открытой и экран включённым.</p>
    {sound.error && <p className="field-error" role="status">{sound.error}</p>}
  </div>;
}
