import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Pause, Play } from "lucide-react";

export const studentMedia = (file) => `${import.meta.env.BASE_URL}media/${file}`;

export function StudentPage({ children, waiting = false, called = false, home = false }) {
  const color = called ? "#36d780" : waiting ? "#f2f6f5" : "#ffffff";
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
    <div className={`student-page ${waiting ? "student-waiting" : ""} ${called ? "student-called" : ""}`}>
      <div className="student-frame">
        {!home && <nav className="student-nav" aria-label="Навигация студента">
          <a href="#/"><ArrowLeft size={17} />Все талоны</a>
          <span>по порядку</span>
        </nav>}
        {children}
        {home && <footer className="student-footer"><a href="#/admin">Вход преподавателя</a></footer>}
      </div>
    </div>
  );
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
