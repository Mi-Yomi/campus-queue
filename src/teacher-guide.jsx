import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, Maximize, Pause, Play, Plus, QrCode, SkipForward, UserPlus, X } from "lucide-react";
import { storage } from "./api";
import "./teacher-guide.css";

const media = `${import.meta.env.BASE_URL}media/`;
const stories = [
  {
    title: "Войдём в ритм?",
    text: "Я покажу, как принимать работы без толпы у стола. Всего пять коротких шагов — и можно начинать пару.",
    note: "Знакомство можно пропустить. Я всегда рядом в разделе «Как пользоваться».",
    type: "welcome", label: "ЗНАКОМСТВО", mascot: "ritm-guide.png",
  },
  {
    title: "Одна пара — одна очередь",
    text: "Нажмите «Создать очередь» и напишите название занятия. Например, «Лабораторная № 3». Больше ничего заполнять не нужно.",
    note: "У каждого преподавателя свои очереди. Вы можете работать одновременно.",
    type: "create", label: "01 / СОЗДАЁМ", mascot: "ritm-guide.png",
  },
  {
    title: "Покажите QR студентам",
    text: "Откройте QR на весь экран. Студенты сканируют его, вводят имя и получают талон. Уже записавшиеся могут показать свежий QR опоздавшим.",
    note: "Код меняется каждые 20 секунд. Талоны при этом остаются на месте.",
    type: "qr", label: "02 / ЗАПИСЫВАЕМ", mascot: "ritm-guide.png",
  },
  {
    title: "Следующий, пожалуйста :3",
    text: "Нажмите «Вызвать следующего» — у студента загорится зелёный экран. Когда он сдаст работу, нажмите эту же кнопку ещё раз.",
    note: "Текущий студент получит отметку «Работа сдана», а следующий — вызов. Звук прозвучит, если студент его включил.",
    type: "next", label: "03 / ПРИНИМАЕМ", mascot: "ritm-done.webp",
  },
  {
    title: "Если что-то пошло не так",
    text: "Студент не подошёл? Нажмите «Не пришёл». Не может записаться с телефона? «Добавить студента» выдаст ему талон по имени.",
    note: "При ручной записи сообщите номер студенту и вызовите его голосом — талон не связан с телефоном.",
    type: "help", label: "04 / ПОМОГАЕМ", mascot: "ritm-guide.png",
  },
  {
    title: "Пара закончилась?",
    text: "Нажмите «Завершить очередь» и подтвердите действие. Она исчезнет из панели, а ожидающие студенты увидят красный экран о завершении.",
    note: "Нужен только перерыв? Выберите «Пауза записи»: новые студенты не запишутся, а существующие талоны сохранятся.",
    type: "finish", label: "05 / ЗАВЕРШАЕМ", mascot: "ritm-done.webp",
  },
];
const STORY_MS = 14000;

// Only the seen flag is stored, scoped to this teacher and this guide version.
export function TeacherGuide({ userId, requestId }) {
  const key = `campus.teacher-guide.v1.${userId}`;
  const [open, setOpen] = useState(() => storage.get(key) !== "seen");
  useEffect(() => { if (requestId > 0) setOpen(true); }, [requestId]);
  function close() {
    storage.set(key, "seen");
    setOpen(false);
  }
  return open ? <GuideStories onClose={close} /> : null;
}

function StoryPreview({ type }) {
  if (type === "welcome") return <div className="guide-welcome-chips"><span>Создать</span><span>Показать QR</span><span>Принимать</span></div>;
  return <div className={`guide-example guide-example-${type}`} aria-hidden="true">
    <span className="guide-example-caption">ВОТ ТАК В ПАНЕЛИ</span>
    {type === "create" && <><strong>Новая очередь</strong><span className="guide-fake-input">Лабораторная № 3</span><span className="guide-fake-button"><Plus size={16} />Создать очередь</span></>}
    {type === "qr" && <><QrCode className="guide-qr-symbol" size={64} strokeWidth={1.6} /><span className="guide-fake-button"><Maximize size={15} />На весь экран</span><small>Свежий код · 20 секунд</small></>}
    {type === "next" && <><div className="guide-ticket-pair"><span><Check size={16} /> A-001<small>Работа сдана</small></span><ArrowRight size={19} /><span>A-002<small>Вас вызывают</small></span></div><span className="guide-fake-button"><Play size={15} />Вызвать следующего</span></>}
    {type === "help" && <><span className="guide-fake-option"><SkipForward size={18} />Не пришёл</span><span className="guide-fake-option"><UserPlus size={18} />Добавить студента</span></>}
    {type === "finish" && <><span className="guide-fake-option"><Pause size={18} />Пауза записи</span><span className="guide-fake-button guide-fake-danger">Завершить очередь</span><small>Сначала попросим подтверждение</small></>}
  </div>;
}

function GuideStories({ onClose }) {
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [held, setHeld] = useState(false);
  const [background, setBackground] = useState(() => document.hidden);
  const dialog = useRef(null), article = useRef(null), elapsed = useRef(0), pointer = useRef(null);
  const story = stories[step], last = step === stories.length - 1;

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    element.querySelector(".guide-next").focus();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  useEffect(() => { article.current.scrollTop = 0; }, [step]);
  useEffect(() => {
    const visibility = () => { setBackground(document.hidden); setHeld(false); };
    const blur = () => { setBackground(true); setHeld(false); };
    const focus = () => setBackground(document.hidden);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
    };
  }, []);
  useEffect(() => {
    // The welcome waits for a deliberate start; the final card never closes
    // itself. Time spent reading in a hidden tab does not consume a story.
    if (!step || last || paused || held || background) return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      elapsed.current += now - previous;
      previous = now;
      if (elapsed.current >= STORY_MS) {
        elapsed.current = 0;
        setProgress(0);
        setStep(value => Math.min(value + 1, stories.length - 1));
      } else setProgress(elapsed.current / STORY_MS);
    }, 100);
    return () => clearInterval(timer);
  }, [step, last, paused, held, background]);

  function goTo(index) {
    elapsed.current = 0;
    setProgress(0);
    setStep(Math.max(0, Math.min(index, stories.length - 1)));
  }
  function release(event) {
    const start = pointer.current;
    pointer.current = null;
    setHeld(false);
    if (!start || event.type !== "pointerup") return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) goTo(step + (dx < 0 ? 1 : -1));
  }
  return createPortal(
    <dialog className="teacher-guide" ref={dialog} aria-label="Как пользоваться РИТМ"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onKeyDown={event => {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          goTo(step + (event.key === "ArrowRight" ? 1 : -1));
        }
      }}>
      <div className="guide-shell">
        <nav className="guide-progress" aria-label="Шаги знакомства">
          {stories.map((item, index) => <button key={item.type} type="button" aria-label={`Шаг ${index + 1}: ${item.title}`}
            aria-current={index === step ? "step" : undefined} onClick={() => goTo(index)}>
            <span><i style={{ transform: `scaleX(${index < step ? 1 : index === step ? (!step || last ? 1 : progress) : 0})` }} /></span>
          </button>)}
        </nav>
        <header className="guide-header">
          <img src={`${import.meta.env.BASE_URL}brand/ritm-mark.webp`} width="36" height="36" alt="" />
          <div><strong>РИТМ</strong><span>ваш помощник на паре</span></div>
          <div className="guide-tools">
            {step > 0 && !last && <button type="button" aria-label={paused ? "Продолжить сторис" : "Приостановить сторис"}
              onClick={() => setPaused(value => !value)}>{paused ? <Play size={19} /> : <Pause size={19} />}</button>}
            <button type="button" aria-label="Закрыть гайд" onClick={onClose}><X size={22} /></button>
          </div>
        </header>
        <article ref={article} className={`guide-story guide-story-${story.type}`} aria-live="polite" aria-atomic="true"
          onPointerDown={event => {
            if (!event.isPrimary || event.button !== 0) return;
            pointer.current = { x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
            setHeld(true);
          }} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={() => setHeld(false)}>
          <div className="guide-art" key={story.type}>
            <div className="guide-mascot-halo" />
            <img className="guide-mascot" src={`${media}${story.mascot}`} width="256" height="256" alt="Маскот РИТМ помогает разобраться" draggable="false" />
            <StoryPreview type={story.type} />
          </div>
          <div className="guide-copy">
            <span className="guide-kicker">{story.label}</span>
            <h2>{story.title}</h2>
            <p>{story.text}</p>
            <div className="guide-note">{story.note}</div>
          </div>
        </article>
        <footer className="guide-footer">
          <div className="guide-controls">
            {step > 0 && <button type="button" className="guide-back" aria-label="Предыдущая сторис" onClick={() => goTo(step - 1)}><ArrowLeft size={20} /></button>}
            <button type="button" className="button primary guide-next" onClick={() => last ? onClose() : goTo(step + 1)} autoFocus>
              {!step ? "Покажите, как всё устроено" : last ? "Всё понятно, начинаем!" : "Дальше"}
              {last ? <Check size={19} /> : <ArrowRight size={19} />}
            </button>
          </div>
          {!step ? <button type="button" className="guide-skip" onClick={onClose}>Пропустить знакомство</button>
            : <div className="guide-footer-caption"><span>{step + 1} / {stories.length}</span><span>{last ? "Этот гайд всегда можно открыть снова" : paused ? "На паузе · листайте в своём темпе" : held ? "Читаем спокойно…" : "Зажмите карточку, чтобы остановить"}</span></div>}
        </footer>
      </div>
    </dialog>, document.body,
  );
}
