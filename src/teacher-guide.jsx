import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, Maximize, Pause, Play, Plus, QrCode, SkipForward, UserPlus, X } from "lucide-react";
import { storage } from "./api";
import "./teacher-guide.css";

const media = `${import.meta.env.BASE_URL}media/`;
const stories = [
  { type: "welcome", label: "ЗНАКОМСТВО С РИТМ", title: "Ваша пара.\nВаш ритм.", accent: "Ваш ритм.",
    text: "Принимайте работы спокойно. Я помогу студентам дождаться своей очереди.", tip: "Пять простых шагов. Попробуем вместе?" },
  { type: "create", label: "01 / СОЗДАЙТЕ ОЧЕРЕДЬ", title: "Всё начинается\nс названия.", accent: "с названия.",
    text: "Нажмите «Создать очередь». Укажите название занятия — и запись открыта.", tip: "Никаких групп и аудиторий. Просто название." },
  { type: "qr", label: "02 / ПРИГЛАСИТЕ СТУДЕНТОВ", title: "Один QR.\nВся группа.", accent: "Вся группа.",
    text: "Покажите код на весь экран. Студенты сканируют, вводят имя и получают талон.", tip: "Опоздавшим свежий QR покажет любой студент, который уже в очереди." },
  { type: "next", label: "03 / ПРИНИМАЙТЕ РАБОТЫ", title: "Одна кнопка.\nСледующий.", accent: "Следующий.",
    text: "«Вызвать следующего» завершает текущую сдачу и приглашает следующего студента.", tip: "Зелёный экран — его очередь. Звук тоже прозвучит, если студент его включил." },
  { type: "help", label: "04 / БЫВАЕТ И ТАКОЕ", title: "На любой\nслучай.", accent: "случай.",
    text: "Кто-то не подошёл? Пропустите его. Не работает телефон? Запишите студента вручную.", tip: "При ручной записи назовите номер студенту и вызовите голосом." },
  { type: "finish", label: "05 / ДО СЛЕДУЮЩЕЙ ПАРЫ", title: "Готово.\nМожно выдохнуть.", accent: "Можно выдохнуть.",
    text: "Завершите очередь с подтверждением. Она исчезнет из панели, а ожидающие увидят, что приём окончен.", tip: "Только перерыв? «Пауза записи» сохранит очередь и остановит новые записи." },
];
const STORY_MS = 14000;

export function TeacherGuide({ userId, requestId }) {
  // A visual refresh does not force existing teachers to repeat onboarding.
  const key = `campus.teacher-guide.v1.${userId}`;
  const [open, setOpen] = useState(() => storage.get(key) !== "seen");
  useEffect(() => { if (requestId > 0) setOpen(true); }, [requestId]);
  const close = () => { storage.set(key, "seen"); setOpen(false); };
  return open ? <GuideStories onClose={close} /> : null;
}

function Mascot({ pose = "ritm-guide.png", className = "" }) {
  return <img className={`guide-mascot ${className}`} src={`${media}${pose}`} width="360" height="360" alt="Маскот РИТМ" draggable="false" />;
}

// These exercises only change component state. They never call the queue API.
function StoryScene({ type, onInteract }) {
  const [state, setState] = useState("idle");
  const [name, setName] = useState("Лабораторная № 3");
  function change(value) { onInteract(); setState(value); }
  if (type === "welcome") return <div className="guide-scene guide-scene-welcome">
    <div className="guide-orbit" />
    <div className="guide-speech">Привет! Я ваш помощник :3</div>
    <Mascot />
    <div className="guide-floating-ticket guide-floating-first"><span className="guide-ticket-dot" /><div><small>Сейчас на приёме</small><strong>A-001</strong></div><Check size={20} /></div>
    <div className="guide-floating-ticket guide-floating-second"><div><small>Следующий</small><strong>A-002</strong></div><ArrowRight size={22} /></div>
    <span className="guide-scene-footnote">Меньше суеты. Больше времени на главное.</span>
  </div>;

  return <div className={`guide-scene guide-scene-${type} guide-demo-${state}`}>
    <span className="guide-demo-label"><span />УЧЕБНЫЙ ПРИМЕР · МОЖНО НАЖИМАТЬ</span>
    <div className="guide-orbit" />
    {type === "create" && <>
      <Mascot className="guide-scene-companion" pose={state === "created" ? "ritm-done.webp" : "ritm-guide.png"} />
      <form className="guide-demo-card guide-create-card" onSubmit={event => { event.preventDefault(); if (name.trim()) change("created"); }}>
        {state === "created" ? <div className="guide-demo-success" role="status"><span className="guide-success-check"><Check size={30} /></span><small>ЗАПИСЬ ОТКРЫТА</small><h3>{name.trim()}</h3><p>Вот и всё. Вы готовы принимать!</p><button type="button" className="guide-demo-reset" onClick={() => change("idle")}>Попробовать ещё раз</button></div>
          : <><span className="guide-demo-icon"><Plus size={22} /></span><h3>Новая очередь</h3><label>Название занятия<input aria-label="Название в учебном примере" value={name} onFocus={onInteract} onChange={event => setName(event.target.value)} required maxLength={60} /></label><button type="submit" className="guide-demo-button">Создать очередь<ArrowRight size={17} /></button></>}
      </form>
      <div className="guide-scene-hint" aria-live="polite">{state === "created" ? "Отличное начало!" : "Попробуйте создать свою первую очередь."}</div>
    </>}
    {type === "qr" && <>
      <Mascot className="guide-scene-companion" />
      <div className="guide-demo-card guide-qr-card">
        <span className="guide-demo-eyebrow">ПРИМЕР QR</span>
        <div className="guide-demo-qr" aria-hidden="true"><QrCode size={134} strokeWidth={1.7} /><span><img src={`${import.meta.env.BASE_URL}brand/ritm-mark.webp`} width="32" height="32" alt="" /></span></div>
        <div className="guide-code-lifetime"><span>20 сек</span><small>новый код — то же место</small></div>
        <button type="button" className="guide-demo-button" onClick={() => change(state === "expanded" ? "idle" : "expanded")}><Maximize size={17} />{state === "expanded" ? "Уменьшить пример" : "На весь экран"}</button>
      </div>
      <div className="guide-scene-hint" aria-live="polite">{state === "expanded" ? "Крупный код проще сканировать с задних парт." : "Код обновляется. Талоны остаются."}</div>
    </>}
    {type === "next" && <>
      <Mascot className="guide-call-mascot" pose={state === "called" ? "ritm-done.webp" : "ritm-sleeping.webp"} />
      <div className={`guide-demo-phone ${state === "called" ? "is-called" : ""}`} aria-live="polite">
        <span className="guide-phone-speaker" /><small>{state === "called" ? "ВАС ВЫЗЫВАЮТ" : "ВАШ ТАЛОН"}</small><strong>A-002</strong><span>{state === "called" ? "Ваша очередь!" : "Ждём приглашения"}</span>
        <div className="guide-phone-status">{state === "called" ? <Check size={28} /> : <span className="guide-wait-dots"><i /><i /><i /></span>}</div>
        <p>{state === "called" ? "Подходите к преподавателю" : "Перед вами один студент"}</p>
      </div>
      <div className="guide-call-action"><button type="button" className="guide-demo-button" onClick={() => change(state === "called" ? "idle" : "called")}><Play size={17} />{state === "called" ? "Повторить пример" : "Вызвать следующего"}</button><span aria-live="polite">{state === "called" ? "А у A-001 уже появилось «Работа сдана» ✓" : "Нажмите и посмотрите на экран студента"}</span></div>
    </>}
    {type === "help" && <>
      <Mascot className="guide-help-mascot" />
      <div className="guide-demo-card guide-help-card"><div className="guide-help-result" aria-live="polite"><strong>{state === "manual" ? "A-003" : "A-001"}</strong><span>{state === "manual" ? "Анна · добавлена вручную" : state === "skipped" ? "Талон пропущен" : "Иногда планы меняются"}</span></div><button type="button" onClick={() => change("skipped")} className="guide-demo-option"><SkipForward size={20} /><span>Не пришёл</span><ArrowRight size={16} /></button><button type="button" onClick={() => change("manual")} className="guide-demo-option"><UserPlus size={20} /><span>Добавить студента</span><ArrowRight size={16} /></button></div>
      <div className="guide-scene-hint" aria-live="polite">{state === "manual" ? "Сообщите студенту: ваш номер A-003." : state === "skipped" ? "Теперь можно вызвать следующего." : "Два простых решения. Попробуйте любое."}</div>
    </>}
    {type === "finish" && <>
      <Mascot className="guide-finish-mascot" pose={state === "ended" ? "ritm-sad.webp" : "ritm-done.webp"} />
      <div className={`guide-demo-card guide-finish-card ${state === "ended" ? "is-ended" : ""}`}>
        {state === "confirm" ? <><span className="guide-demo-eyebrow">БЕЗ СЛУЧАЙНЫХ НАЖАТИЙ</span><h3>Завершить очередь?</h3><p>Открыть её снова нельзя.</p><button type="button" className="guide-demo-button guide-demo-danger" onClick={() => change("ended")}>Да, завершить</button><button type="button" className="guide-demo-reset" onClick={() => change("idle")}>Продолжить приём</button></>
          : state === "ended" ? <div role="status"><small>ЭКРАН СТУДЕНТА</small><h3>Очередь<br />завершена</h3><p>Увидимся на следующей паре.</p><button type="button" className="guide-demo-reset" onClick={() => change("idle")}>Повторить пример</button></div>
          : <><span className="guide-demo-eyebrow">ВСЁ ПОД КОНТРОЛЕМ</span><h3>На сегодня всё?</h3><p>Студенты узнают об этом сразу.</p><button type="button" className="guide-demo-button guide-demo-danger" onClick={() => change("confirm")}>Завершить очередь</button><span className="guide-confirm-note">Сначала попросим подтверждение</span></>}
      </div>
    </>}
  </div>;
}

function GuideStories({ onClose }) {
  const [step, setStep] = useState(0), [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [held, setHeld] = useState(false), [background, setBackground] = useState(() => document.hidden);
  const dialog = useRef(null), article = useRef(null), elapsed = useRef(0), pointer = useRef(null);
  const story = stories[step], last = step === stories.length - 1;
  useEffect(() => {
    const element = dialog.current, previousFocus = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal(); element.querySelector(".guide-next").focus();
    return () => { element.close(); document.body.style.overflow = overflow; if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  useEffect(() => { article.current.scrollTop = 0; }, [step]);
  useEffect(() => {
    const visibility = () => { setBackground(document.hidden); setHeld(false); };
    const blur = () => { setBackground(true); setHeld(false); };
    const focus = () => setBackground(document.hidden);
    document.addEventListener("visibilitychange", visibility); window.addEventListener("blur", blur); window.addEventListener("focus", focus);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("blur", blur); window.removeEventListener("focus", focus); };
  }, []);
  useEffect(() => {
    if (!step || last || paused || held || background) return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(); elapsed.current += now - previous; previous = now;
      if (elapsed.current >= STORY_MS) { elapsed.current = 0; setProgress(0); setStep(value => Math.min(value + 1, stories.length - 1)); }
      else setProgress(elapsed.current / STORY_MS);
    }, 100);
    return () => clearInterval(timer);
  }, [step, last, paused, held, background]);
  function goTo(index) { elapsed.current = 0; setProgress(0); setStep(Math.max(0, Math.min(index, stories.length - 1))); }
  function release(event) {
    const start = pointer.current; pointer.current = null; setHeld(false);
    if (!start || event.type !== "pointerup") return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) goTo(step + (dx < 0 ? 1 : -1));
  }
  return createPortal(<dialog ref={dialog} className={`teacher-guide guide-theme-${story.type} ${paused || held || background ? "guide-motion-paused" : ""}`} aria-label="Как пользоваться РИТМ"
    onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => {
      if (event.target.closest("input, textarea, select")) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); goTo(step + (event.key === "ArrowRight" ? 1 : -1)); }
    }}>
    <div className="guide-shell">
      <header className="guide-header"><div className="guide-brand"><img src={`${import.meta.env.BASE_URL}brand/ritm-mark.webp`} width="34" height="34" alt="" /><strong>РИТМ</strong></div>
        <nav className="guide-progress" aria-label="Шаги знакомства">{stories.map((item, index) => <button type="button" key={item.type} aria-label={`Шаг ${index + 1}: ${item.title.replace("\n", " ")}`} aria-current={index === step ? "step" : undefined} onClick={() => goTo(index)}><span><i style={{ transform: `scaleX(${index < step ? 1 : index === step ? (!step || last ? 1 : progress) : 0})` }} /></span></button>)}</nav>
        <div className="guide-tools">{step > 0 && !last && <button type="button" aria-label={paused ? "Продолжить сторис" : "Приостановить сторис"} onClick={() => setPaused(value => !value)}>{paused ? <Play size={18} /> : <Pause size={18} />}</button>}<button type="button" aria-label="Закрыть гайд" onClick={onClose}><X size={21} /></button></div>
      </header>
      <article ref={article} className="guide-body" onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0 || event.target.closest("button, input, label, form")) return;
        pointer.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); setHeld(true);
      }} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={() => setHeld(false)}>
        <div className="guide-slide" key={story.type}>
          <section className="guide-copy" aria-live="polite" aria-atomic="true"><span className="guide-kicker">{story.label}</span><h2>{story.title.split("\n").map(line => <span key={line} className={line === story.accent ? "guide-accent" : ""}>{line}</span>)}</h2><p>{story.text}</p><div className="guide-tip"><span className="guide-tip-mark">:3</span><p>{story.tip}</p></div></section>
          <StoryScene type={story.type} onInteract={() => setPaused(true)} />
        </div>
      </article>
      <footer className="guide-footer"><div className="guide-footer-left">{!step ? <button type="button" className="guide-skip" onClick={onClose}>Пропустить знакомство</button> : <><button type="button" className="guide-back" aria-label="Предыдущая сторис" onClick={() => goTo(step - 1)}><ArrowLeft size={19} /></button><span className="guide-page-count">{String(step).padStart(2, "0")}<span> / 05</span></span></>}</div>
        <span className="guide-footer-note">{!step ? "Около минуты — и вы освоились" : last ? "Вы готовы к первой паре" : paused ? "В вашем темпе" : "Можно листать стрелками"}</span>
        <button type="button" className="guide-next" onClick={() => last ? onClose() : goTo(step + 1)}>{!step ? "Давайте начнём" : last ? "Перейти в панель" : "Дальше"}{last ? <Check size={19} /> : <ArrowRight size={19} />}</button>
      </footer>
    </div>
  </dialog>, document.body);
}
