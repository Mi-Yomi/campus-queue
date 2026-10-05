import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Pause, Play } from "lucide-react";
import { Brand } from "./ui";
import { CreatorBanner } from "./creator-banner";

export const studentMedia = (file) => `${import.meta.env.BASE_URL}media/${file}`;

export function StudentPage({ children, waiting = false, called = false, ended = false, completed = false, home = false }) {
  const color = completed ? "#f2f8f3" : ended ? "#df454d" : called ? "#36d780" : waiting ? "#f2f6f5" : "#ffffff";
  useEffect(() => {
    const theme = document.querySelector('meta[name="theme-color"]');
    const previousTheme = theme?.content;
    const background = document.body.style.backgroundColor;
    document.body.style.backgroundColor = color;
    if (theme) theme.content = color;
    return () => {
      document.body.style.backgroundColor = background;
      if (theme && previousTheme) theme.content = previousTheme;
    };
  }, [color]);
  return (
    <div className={`student-page ${waiting ? "student-waiting" : ""} ${called ? "student-called" : ""} ${ended ? "student-ended" : ""} ${completed ? "student-completed" : ""}`}>
      <div className="student-frame">
        {home && <div className="student-home-brand"><Brand compact /></div>}
        {!home && <nav className="student-nav" aria-label="Навигация студента">
          <a href="#/"><ArrowLeft size={17} />Все талоны</a>
          <Brand compact />
        </nav>}
        {children}
        {home && !called && <CreatorBanner className="student-home-creator" />}
        {home && <footer className="student-footer"><a href="#/admin">Вход преподавателя</a></footer>}
      </div>
    </div>
  );
}

export function WorkDone({ settings, ticket }) {
  return <main className="student-done-screen" role="status" aria-live="polite">
    <img src={studentMedia("ritm-done.webp")} alt="Котик РИТМ показывает лапкой палец вверх" width="240" height="240" />
    <span className="student-done-badge">{ticket.number} · Готово!</span>
    <h1>Работа сдана!</h1>
    <p>Можно спокойно сидеть<br />и отдыхать :3</p>
    <span className="student-done-class">{[settings.title, settings.room].filter(Boolean).join(" · ")}</span>
    <a className="student-done-home" href="#/">К моим талонам</a>
  </main>;
}

export function QueueEnded({ settings }) {
  return <main className="queue-ended-screen" role="status" aria-live="polite">
    <img src={studentMedia("ritm-sad.webp")} alt="Грустный котик РИТМ" width="180" height="180" />
    <p className="ended-eyebrow">На сегодня всё</p>
    <h1>Очередь завершена</h1>
    <p>Преподаватель закончил приём.<br />К сожалению, эта очередь больше не работает.</p>
    <span className="ended-class">{[settings.title, settings.room].filter(Boolean).join(" · ")}</span>
    <a className="ended-home" href="#/">К моим талонам</a>
    <small>Для следующей пары отсканируйте новый QR.</small>
  </main>;
}

export function WaitingLoop() {
  const video = useRef(null);
  const [playing, setPlaying] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const sync = () => {
      if (playing && document.visibilityState === "visible") element.play().catch(() => setPlaying(false));
      else element.pause();
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => { element.pause(); document.removeEventListener("visibilitychange", sync); };
  }, [playing]);
  return (
    <section className="student-loop" aria-label="Видео AUES">
      <video ref={video} muted loop playsInline preload="metadata"
        poster={studentMedia("aues-poster.jpg")} aria-label="Анимация AUES во время ожидания"
        onError={() => { setFailed(true); setPlaying(false); }}>
        <source src={studentMedia("aues-loop.mp4")} type="video/mp4" />
      </video>
      {!failed && <button type="button" className="student-video-toggle"
        onClick={() => setPlaying(!playing)} aria-label={playing ? "Приостановить видео" : "Воспроизвести видео"}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>}
    </section>
  );
}
