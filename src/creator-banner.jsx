import React, { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Brand } from "./ui";

const media = (file) => `${import.meta.env.BASE_URL}media/${file}`;

export function CreatorBanner({ className = "" }) {
  const video = useRef(null);
  const [playing, setPlaying] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = video.current;
    if (!element || failed) return;
    let visible = true, active = true;
    const sync = () => {
      if (playing && visible && document.visibilityState === "visible") {
        element.play().catch(() => { if (active) setPlaying(false); });
      } else element.pause();
    };
    const observer = window.IntersectionObserver ? new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    }) : null;
    observer?.observe(element);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      active = false;
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      element.pause();
    };
  }, [playing, failed]);

  return (
    <section className={`creator-banner ${className}`} aria-label="О проекте РИТМ и его авторе">
      {failed ? <img className="creator-banner-background" src={media("creator-banner-poster.jpg")} alt="" /> :
        <video ref={video} className="creator-banner-background" muted loop playsInline
          preload={playing ? "metadata" : "none"} poster={media("creator-banner-poster.jpg")}
          aria-hidden="true" onError={() => setFailed(true)}>
          <source src={media("creator-banner.mp4")} type="video/mp4" />
        </video>}
      <div className="creator-banner-content">
        <Brand compact />
        <p>Онлайн-очередь на сдачу работ</p>
        <span className="creator-banner-credit">by Anuar Lukpanov <span aria-hidden="true">|</span> Сиб-24-7Б</span>
      </div>
      {!failed && <button type="button" className="creator-banner-toggle"
        aria-label={playing ? "Приостановить фон баннера" : "Воспроизвести фон баннера"}
        onClick={() => setPlaying(!playing)}>
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>}
    </section>
  );
}
