import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  Check,
  Clock3,
  Copy,
  GraduationCap,
  LoaderCircle,
  Link2,
  LogOut,
  LockKeyhole,
  MapPin,
  Monitor,
  Pause,
  Play,
  Plus,
  QrCode,
  Settings2,
  ShieldCheck,
  SkipForward,
  Ticket,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { request, storage, visitorStorageAvailable, cloudEnabled } from "./api";
import { queueBase } from "./queue-links.mjs";
import { MinuteIntervalField } from "./minute-interval-field";
import { InviteLinkDialog } from "./invite-link";
import { studentDraft, savedStudentName, rememberStudentName } from "./student-profile.mjs";
import { estimateMinutes, durationLabel, serviceSeconds } from "./queue-analytics.mjs";
import {
  Brand,
  Button,
  Status,
  Empty,
  ErrorBox,
  Dialog,
  LiveQR,
  useResource,
  time,
  statusNames,
  activeTicket,
  here,
} from "./ui";
import "@fontsource/golos-text/cyrillic-400.css";
import "@fontsource/golos-text/cyrillic-500.css";
import "@fontsource/golos-text/cyrillic-600.css";
import "@fontsource/golos-text/cyrillic-700.css";
import "@fontsource/golos-text/latin-400.css";
import "@fontsource/golos-text/latin-500.css";
import "@fontsource/golos-text/latin-600.css";
import "@fontsource/golos-text/latin-700.css";
import "./styles.css";
import { StudentPage, WaitingLoop, QueueEnded, WorkDone, studentMedia } from "./student-ui";
import "./student.css";
import "./app-theme.css";
import "./creator-banner.css";
import { CreatorBanner } from "./creator-banner";
import { AppIcon } from "./app-icon";
import { PasswordChange } from "./password-change";
import { useStudentSound, StudentSound } from "./student-sound";
import { StudentRoster } from "./student-roster";
import { ConnectionNotice } from "./connection-notice";
import { ManualEnrollment } from "./manual-enrollment";

function savedBase() {
  if (cloudEnabled) return queueBase(location.href, null, true);
  try {
    const url = new URL(storage.get("campus.link.v1"));
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error();
    url.hash = "";
    return url.href;
  } catch {
    return here();
  }
}
function Shell({
  children,
  admin = false,
  user,
  tab,
  setTab,
  onLogout,
  onPasswordChange,
  data,
  error,
  displayUrl,
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href={admin ? "#/admin" : "#/"} className="brand-link">
          <Brand />
        </a>
        <div className="nav-caption">
          {admin
            ? user?.role === "owner"
              ? "ВЛАДЕЛЕЦ"
              : "ПРЕПОДАВАТЕЛЬ"
            : "СТУДЕНТ"}
        </div>
        <nav>
          {admin ? (
            <>
              <button
                className={tab === "queue" ? "active" : ""}
                onClick={() => setTab("queue")}
              >
                <AppIcon name="ticket" />
                Приём работ
              </button>
              <details className="teacher-nav-more">
                <summary>Настройки и ссылки</summary>
              <button
                className={tab === "qr" ? "active" : ""}
                onClick={() => setTab("qr")}
              >
                <QrCode size={19} />
                QR и ссылка для записи
              </button>
              <button
                className={tab === "settings" ? "active" : ""}
                onClick={() => setTab("settings")}
              >
                <Settings2 size={19} />
                Настройки пары
              </button>
              </details>
              {user?.role === "owner" && (
                <button
                  className={tab === "teachers" ? "active" : ""}
                  onClick={() => setTab("teachers")}
                >
                  <AppIcon name="teacher" />
                  Преподаватели
                </button>
              )}
            </>
          ) : (
            <>
              <a href="#/" className="active">
                <Ticket size={19} />
                Мои талоны
              </a>
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <AppIcon name="teacher" />
            <span>
              {admin ? user?.name : "Талон остаётся с вами"}
              <span>
                {admin
                  ? (user?.role === "owner" ? "Владелец системы" : "Преподаватель")
                  : "Обновление QR не меняет ваше место в очереди."}
              </span>
            </span>
          </div>
          {admin ? (
            <>
            <button className="sidebar-account" onClick={onPasswordChange}>
              <LockKeyhole size={18} />
              Сменить пароль
            </button>
            <button className="sidebar-account" onClick={onLogout}>
              <LogOut size={18} />
              Выйти из панели
            </button>
            </>
          ) : (
            <a className="sidebar-account" href="#/admin">
              <ShieldCheck size={18} />
              Вход преподавателя
            </a>
          )}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            Университет <span>/</span>
            {admin ? "Панель преподавателя" : "Сдача работ"}
          </span>
          <span className={`live-label ${error ? "offline" : ""}`}>
            {error ? <WifiOff size={15} /> : <Wifi size={15} />}
            <span>
              {error ? "Нет связи" : data ? "Подключено" : "Подключение…"}
            </span>
          </span>
        </header>
        <main>{children}</main>
        <footer>
          <span>РИТМ · очередь на пару</span>
          <span>
            {data?.serverTime
              ? `Обновлено в ${time(data.serverTime)} · ${cloudEnabled ? "в реальном времени" : "каждые 3 сек"}`
              : "Ваши талоны сохраняются в этом браузере"}
          </span>
        </footer>
      </div>
    </div>
  );
}
function App() {
  const [route, setRoute] = useState(location.hash.slice(1) || "/"),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const update = () => setRoute(location.hash.slice(1) || "/");
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  const [path, query = ""] = route.split("?"),
    parts = path.split("/"),
    params = new URLSearchParams(query);
  let content;
  if (parts[1] === "admin") content = <AdminGate notify={setNotice} />;
  else if (parts[1] === "q" && parts[2])
    content = (
      <Visitor
        key={parts[2]}
        queueId={decodeURIComponent(parts[2])}
        invite={params.get("invite")}
        notify={setNotice}
      />
    );
  else if (parts[1] === "screen" && parts[2])
    content = (
      <Screen
        key={parts[2]}
        queueId={decodeURIComponent(parts[2])}
        displayToken={params.get("display")}
      />
    );
  else content = <Home />;
  return (
    <>
      {content}
      <div className={`toast ${notice ? "visible" : ""}`} role="status">
        {notice && <Check size={18} />} {notice}
      </div>
    </>
  );
}
function Home() {
  const resource = useResource("/me/tickets"), { data, error } = resource;
  const current = data?.tickets.filter(activeTicket) || [];
  const past = data?.tickets.filter((ticket) => !activeTicket(ticket)) || [];
  return (
    <StudentPage home called={current.some((ticket) => ticket.status === "called")}>
      <ConnectionNotice {...resource} retry={resource.refresh} ticketSaved={!!current.length} />
      {!current.length ? (
        <main className="student-empty">
          {data ? <img src={studentMedia("sleeping.png")} alt="" width="92" height="95" />
            : <LoaderCircle className="spin" size={36} />}
          <h1>{data ? "У вас нет талонов" : error ? "Не удалось загрузить талоны" : "Ищем ваши талоны…"}</h1>
          <p>{data ? <>Отсканируйте QR для того,<br />чтобы встать в очередь</> : "Ваши сохранённые талоны появятся здесь."}</p>
        </main>
      ) : (
        <main className="student-tickets">
          <h1>{current.some((ticket) => ticket.status === "called") ? "Вас вызывают!" : "Ваши талоны"}</h1>
          <p className="student-subtitle">Выберите пару, чтобы следить за очередью</p>
          {current.map((ticket) => <a key={ticket.id} className="student-ticket-link" href={`#/q/${ticket.queueId}`}>
            <span>{ticket.status === "called" ? "Ваша очередь — подходите" : "Вы в очереди"}</span>
            <strong>{ticket.number}</strong>
            <h2>{ticket.queue.title}</h2>
            <p>{[ticket.queue.teacherName, ticket.queue.room].filter(Boolean).join(" · ")}</p>
            <span className="student-ticket-open">Открыть талон <ArrowUpRight size={16} /></span>
          </a>)}
        </main>
      )}
      {!!past.length && <details className="student-history">
        <summary>Прошлые талоны · {past.length}</summary>
        {past.map((ticket) => <a key={ticket.id} href={`#/q/${ticket.queueId}`}>
          <span>{ticket.queue.title}<small>{ticket.queue.endedAt ? "Очередь завершена" : statusNames[ticket.status]}</small></span><strong>{ticket.number}</strong>
        </a>)}
      </details>}
    </StudentPage>
  );
}
function Visitor({ queueId, invite, notify }) {
  const resource = useResource(`/queues/${queueId}`),
    { data, error, refresh } = resource;
  const [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(""),
    [share, setShare] = useState(false),
    [confirm, setConfirm] = useState(false),
    [draft, setDraft] = useState(() => studentDraft(storage, queueId)),
    [redeeming, setRedeeming] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const handled = useRef(null),
    [nowTick, setNowTick] = useState(Date.now());
  const ended = !!data?.settings.endedAt;
  const active = !ended && activeTicket(data?.mine),
    mine = data?.mine;
  const called = active && mine.status === "called";
  const completed = mine?.status === "done" && !mine.previousSession;
  const sound = useStudentSound(called ? `${mine.id}:${mine.calledAt}` : null);
  useEffect(() => {
    if (!active || !data?.rosterNeedsRefresh) return;
    const timer = setTimeout(refresh, error ? 5000 : 250);
    return () => clearTimeout(timer);
  }, [active, data?.rosterNeedsRefresh, data?.revision, error, refresh]);
  useEffect(() => {
    if (called || ended || completed) {
      setShare(false);
      setConfirm(false);
      if (!completed) navigator.vibrate?.([200, 100, 200]);
    }
  }, [called, ended, completed]);
  useEffect(() => {
    // Existing students also get a reusable name without having to retype it.
    if (mine?.name && savedStudentName(storage) === null) {
      rememberStudentName(storage, mine.name);
      setDraft((current) => current.name ? current : { name: mine.name });
    }
  }, [mine?.name]);
  const clock = useRef({ server: Date.now(), client: performance.now() });
  useEffect(() => {
    if (data)
      clock.current = { server: data.serverNow, client: performance.now() };
  }, [data]);
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const seconds = data?.admission
    ? Math.max(
        0,
        Math.ceil(
          (data.admission.expiresAt -
            (clock.current.server + performance.now() - clock.current.client)) /
            1000,
        ),
      )
    : 0;
  useEffect(() => {
    if (!data || ended || !invite || handled.current === invite || error) return;
    if (
      active || completed ||
      (data.admission && data.admission.expiresAt > data.serverNow)
    ) {
      handled.current = invite;
      history.replaceState(null, "", `${here()}#/q/${queueId}`);
      return;
    }
    handled.current = invite;
    const currentInvite = invite;
    const stillCurrent = () =>
      mounted.current && handled.current === currentInvite;
    setRedeeming(true);
    setActionError("");
    request(`/queues/${queueId}/redeem`, { method: "POST", body: { invite } })
      .then(async () => {
        await refresh();
        if (stillCurrent())
          history.replaceState(null, "", `${here()}#/q/${queueId}`);
      })
      .catch((e) => {
        if (stillCurrent()) setActionError(e.message);
      })
      .finally(() => {
        if (stillCurrent()) setRedeeming(false);
      });
  }, [
    invite,
    data?.settings.generation,
    !!data,
    active,
    completed,
    ended,
    queueId,
    error,
    refresh,
  ]);
  useEffect(() => {
    document.title =
      called
        ? "Вас вызывают! — РИТМ"
        : completed ? "Работа сдана! — РИТМ" : "РИТМ — очередь на пару";
    return () => { document.title = "РИТМ — очередь на пару"; };
  }, [called, completed]);
  async function act(path, body) {
    setBusy(true);
    setActionError("");
    try {
      await request(`/queues/${queueId}${path}`, { method: "POST", body });
      await refresh();
      setConfirm(false);
      notify(
        path === "/join"
          ? "Вы записаны. Талон сохранён."
          : "Вы вышли из очереди.",
      );
    } catch (e) {
      setActionError(e.message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  const change = (key, value) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    storage.set(`campus.draft.v2.${queueId}`, JSON.stringify(next));
    if (key === "name") rememberStudentName(storage, value);
  };
  return (
    <StudentPage waiting={active} called={called} ended={ended && !completed} completed={completed}>
      <ConnectionNotice {...resource} retry={refresh} ticketSaved={!!active} />
      {!data ? (
        <main className="student-empty"><LoaderCircle className="spin" size={32} /><h1>Загружаем очередь…</h1></main>
      ) : completed ? <WorkDone settings={data.settings} ticket={mine} /> : ended ? <QueueEnded settings={data.settings} /> : active ? (
        <main className="student-ticket-screen">
          <section className="student-receipt" role={called ? "alert" : undefined} aria-live={called ? "assertive" : "off"}>
            <p className="student-ticket-label">{called ? "Вас вызывают" : "Ваш номер"}</p>
            <div className="student-ticket-number">{mine.number}</div>
            <h1>{called ? "Ваша очередь!" : data.current ? "Ожидайте, сейчас идёт приём" : "Ожидайте вызова преподавателя"}</h1>
            {called ? <p className="student-call-direction">Подходите к преподавателю</p>
              : <p className="student-current-person">{data.current ? `Сейчас принимают: ${data.current.number}` : "Преподаватель скоро вызовет следующего"}</p>}
            <p className="student-class-caption">{[data.settings.title, data.settings.room].filter(Boolean).join(" · ")}</p>
          </section>
          {called ? (
            <section className="student-call-details">
              <span className="student-call-check"><Check size={42} strokeWidth={2.5} /></span>
              <h2>{data.settings.teacherName}</h2>
              <p>{mine.name}, можно сдавать работу</p>
            </section>
          ) : (
            <>
              <WaitingLoop />
              <div className="student-wait-estimate" aria-label="Ожидание в очереди">
                <span>Перед вами <strong>{mine.ahead} чел.</strong></span>
                <span>{mine.ahead === 0 ? "Вы следующий" : mine.estimatedMinutes == null ? "Время пока неизвестно" : `Примерно ${mine.estimatedMinutes} мин`}</span>
              </div>
            </>
          )}
          <div className="student-actions">
            <button type="button" disabled={!data.canShare || !!error} onClick={() => setShare(true)}>
              <img src={studentMedia("heart.png")} alt="" width="32" height="32" />
              <span>Показать QR</span>
            </button>
            <button type="button" disabled={busy || !!error} onClick={() => setConfirm(true)}>
              <img src={studentMedia("heartbreak.png")} alt="" width="32" height="32" />
              <span>Уйти с очереди</span>
            </button>
          </div>
          <StudentSound sound={sound} />
          {actionError && <p className="field-error" role="alert">{actionError}</p>}
          <StudentRoster roster={data.roster} mine={mine} refreshing={data.rosterNeedsRefresh} />
        </main>
      ) : (
        <main className="student-enroll">
          <header className="student-enroll-heading">
            <h1>Запись в очередь</h1>
            <p>{[data.settings.title, data.settings.room].filter(Boolean).join(" · ")}</p>
          </header>
          {mine && <p className="student-finished" role="status">
            {mine.previousSession ? "Началась новая пара. Для записи нужен свежий QR или ссылка."
              : mine.status === "skipped" ? "Ваш номер пропущен. Для новой записи откройте свежую ссылку или QR."
              : "Вы вышли из очереди. Для новой записи нужен свежий QR или ссылка."}
          </p>}
          {redeeming ? (
            <div className="student-empty"><LoaderCircle className="spin" /><p>Проверяем приглашение…</p></div>
          ) : data.admission && seconds > 0 ? (
            <form className="student-enroll-form" onSubmit={(event) => {
              event.preventDefault();
              sound.control.enableOnJoin();
              act("/join", { name: draft.name || "", grantId: data.admission.id });
            }}>
              <div className="student-form-fields">
                <label>Имя и фамилия
                  <input name="name" required maxLength={60} autoComplete="name" placeholder="Например, Лукпанов Ануар"
                    value={draft.name || ""} onChange={(event) => change("name", event.target.value)} />
                </label>
                <p className="student-queue-count">{data.stats.waiting ? `Сейчас в очереди: ${data.stats.waiting} чел.` : "В очереди пока никого. Будете первым :)"}</p>
                <p className="student-name-hint">Имя сохраним для следующих пар. Его увидят преподаватель и участники этой очереди.</p>
                {(data.settings.status !== "open" || !data.settings.teacherActive) && <Status status={data.settings.status} disabled={!data.settings.teacherActive} />}
                <p className="student-admission-time">Вход подтверждён · на запись осталось {seconds} с</p>
              </div>
              {actionError && <p className="field-error" role="alert">{actionError}</p>}
              <button className="student-enroll-submit" disabled={busy || !!error || data.settings.status !== "open" || !data.settings.teacherActive || seconds <= 0}>
                {busy ? "Записываем…" : "Записаться :3"}
              </button>
            </form>
          ) : (
            <section className="student-empty student-needs-qr">
              <img src={studentMedia("sleeping.png")} alt="" width="92" height="95" />
              <h2>Нужно приглашение</h2>
              <p>Откройте свежую ссылку от преподавателя или отсканируйте QR у него или одногруппника.</p>
              {actionError && <p className="field-error" role="alert">{actionError}</p>}
            </section>
          )}
        </main>
      )}
      {share && data && active && (
        <LiveQR queueId={queueId} generation={data.settings.generation} qrIntervalSeconds={data.settings.qrIntervalSeconds} enabled={data.canShare && !error}
          title={data.settings.title} subtitle={data.settings.teacherName} initiallyExpanded onClose={() => setShare(false)} />
      )}
      {confirm && active && (
        <Dialog title="Выйти из очереди?" onClose={() => setConfirm(false)}>
          <p>При повторной записи нужен свежий QR или ссылка, а место будет в конце очереди.</p>
          <div className="dialog-actions">
            <Button tone="secondary" onClick={() => setConfirm(false)}>Остаться</Button>
            <Button tone="danger" disabled={busy} onClick={() => act("/leave")}>Выйти</Button>
          </div>
          <ErrorBox error={actionError} />
        </Dialog>
      )}
    </StudentPage>
  );
}

function Login({ onLogin }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <CreatorBanner className="login-creator-banner" />
      <div className="panel login-panel">
        <span className="login-symbol">
          <AppIcon name="teacher" />
        </span>
        <div className="eyebrow">ПРЕПОДАВАТЕЛЬ</div>
        <h1>
          Ваша пара.
          <br />
          Ваша очередь.
        </h1>
        <p>Войдите, чтобы открыть запись и принимать работы.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              const result = await request("/admin/login", {
                method: "POST",
                body: {
                  username: f.get("username"),
                  password: f.get("password"),
                },
              });
              if (!storage.set("campus.admin.v1", result.token, true))
                throw new Error("Разрешите хранение данных сайта.");
              onLogin(result.token);
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Логин
            <input
              name="username"
              autoComplete="username"
              required
              maxLength={32}
              placeholder="Логин преподавателя"
            />
          </label>
          <label>
            Пароль
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={200}
              placeholder="Введите пароль"
            />
          </label>
          <ErrorBox error={error} />
          <Button className="wide" disabled={busy}>
            <ShieldCheck size={18} />
            {busy ? "Входим…" : "Войти в панель"}
          </Button>
        </form>
        <a className="text-link" href="#/">
          Вернуться к моим талонам
        </a>
      </div>
    </div>
  );
}
function AdminGate({ notify }) {
  const [token, setToken] = useState(() =>
    storage.get("campus.admin.v1", true),
  );
  return token ? (
    <Admin
      key={token}
      notify={notify}
      onLogout={() => {
        storage.set("campus.admin.v1", "", true);
        setToken(null);
      }}
    />
  ) : (
    <Login onLogin={setToken} />
  );
}
function Metric({ artwork, label, value, unit, detail, color }) {
  return (
    <section className="panel metric">
      <div className="metric-title">
        <span>{label}</span>
        <span className={`metric-icon ${color}`}>
          <AppIcon name={artwork} />
        </span>
      </div>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
      <p>{detail}</p>
    </section>
  );
}
function Admin({ notify, onLogout }) {
  const me = useResource("/admin/me", { admin: true, poll: 5000 }),
    user = me.data?.user;
  const [passwordSaved, setPasswordSaved] = useState(false);
  const passwordRequired = !!user?.passwordChangeSuggested && !passwordSaved;
  const queues = useResource("/admin/queues", {
    admin: true,
    enabled: !!user && !passwordRequired,
    poll: 5000,
  });
  const [selected, setSelected] = useState(
      () => storage.get("campus.selected.v2") || "",
    ),
    [tab, setTab] = useState("queue"),
    [historyView, setHistoryView] = useState(false),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(""),
    [create, setCreate] = useState(false),
    [inviteLinkOpen, setInviteLinkOpen] = useState(false),
    [resetGeneration, setResetGeneration] = useState(null),
    [endTarget, setEndTarget] = useState(null),
    [manualQueue, setManualQueue] = useState(null),
    [baseUrl, setBaseUrl] = useState(savedBase),
    [displayUrl, setDisplayUrl] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [securityRevision, setSecurityRevision] = useState(0);
  // Keep each queue's last link outside the dialog so closing it preserves its original expiry.
  const [inviteLinks, setInviteLinks] = useState({});
  const showPassword = user && passwordOpen;
  function closePassword() { setPasswordOpen(false); }
  function passwordChanged() {
    // The successful mutation is authoritative even if the follow-up read fails.
    setPasswordSaved(true);
    me.refresh();
    closePassword();
    setInviteLinks({});
    setSecurityRevision((value) => value + 1);
    notify("Пароль изменён. На других устройствах потребуется войти заново.");
  }
  const qid =
    queues.data?.queues.find((q) => q.id === selected)?.id ||
    queues.data?.queues[0]?.id;
  useEffect(() => {
    const list = queues.data?.queues;
    if (list?.length && !list.some((q) => q.id === selected)) {
      setSelected(list[0].id);
      storage.set("campus.selected.v2", list[0].id);
    }
  }, [queues.data, selected]);
  const current = useResource(qid ? `/admin/queues/${qid}` : null, {
    admin: true,
    enabled: !!qid && !!user && !passwordRequired,
  });
  const { data, error, refresh } = current,
    connectionError = me.error || queues.error || error;
  useEffect(() => {
    if (connectionError?.status === 401) onLogout();
  }, [connectionError?.status, onLogout]);
  useEffect(() => {
    if (
      !user || passwordRequired ||
      storage.get("campus.link.v1") ||
      !["localhost", "127.0.0.1"].includes(location.hostname)
    )
      return;
    request("/admin/network", { admin: true })
      .then((r) => {
        if (r.addresses[0]) {
          const url = `${location.protocol}//${r.addresses[0]}:${location.port}${location.pathname}`;
          storage.set("campus.link.v1", url);
          setBaseUrl(url);
        }
      })
      .catch(() => {});
  }, [!!user, passwordRequired]);
  useEffect(() => {
    setDisplayUrl("");
    if (!qid || !data || !user || passwordRequired) return;
    let alive = true;
    request(`/admin/queues/${qid}/display-session`, {
      admin: true,
      method: "POST",
    })
      .then((r) => {
        if (alive) setDisplayUrl(`${here()}#/screen/${qid}?display=${r.token}`);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [qid, data?.settings.generation, securityRevision, passwordRequired]);
  useEffect(() => setInviteLinkOpen(false), [qid, data?.settings.generation, securityRevision]);
  async function act(suffix, body, message, method = "POST", target = qid) {
    if (!target) return false;
    setBusy(true);
    setActionError("");
    try {
      const result = await request(`/admin/queues/${target}${suffix}`, {
        admin: true,
        method,
        body,
      });
      await Promise.all([refresh(), queues.refresh()]);
      if (message) notify(typeof message === "function" ? message(result) : message);
      return true;
    } catch (e) {
      setActionError(e.message);
      await refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (data?.settings.endedAt) queues.refresh();
  }, [data?.settings.endedAt, queues.refresh]);
  async function endCurrentQueue() {
    if (!endTarget || busy) return;
    setBusy(true);
    setActionError("");
    try {
      await request(`/admin/queues/${endTarget.id}/end`, {
        admin: true, method: "POST",
        body: { confirmation: "ЗАВЕРШИТЬ", generation: endTarget.generation },
      });
      setEndTarget(null);
      setSelected("");
      storage.set("campus.selected.v2", "");
      setTab("queue");
      await queues.refresh();
      notify("Очередь завершена.");
    } catch (e) {
      setActionError(e.message);
    } finally { setBusy(false); }
  }
  async function logout() {
    try {
      await request("/admin/logout", { method: "POST", admin: true });
      onLogout();
    } catch (e) {
      setActionError(e.message);
    }
  }
  const disabled = busy || !!connectionError || !!data?.settings.endedAt;
  const inviteLinkKey = data ? `${qid}-${data.settings.generation}` : "";
  if (passwordRequired) return (
    <div className="password-required-page">
      <Brand />
      <PasswordChange user={user} required onChanged={passwordChanged} onLogout={async () => {
        await request("/admin/logout", { method: "POST", admin: true });
        onLogout();
      }} />
    </div>
  );
  const tickets =
    data?.tickets.filter((t) =>
      historyView
        ? !["waiting", "called"].includes(t.status)
        : ["waiting", "called"].includes(t.status),
    ) || [];
  return (
    <Shell
      admin
      user={user}
      tab={tab}
      setTab={setTab}
      onLogout={logout}
      onPasswordChange={() => setPasswordOpen(true)}
      data={data || me.data}
      error={connectionError}
      displayUrl={displayUrl}
    >
      <ConnectionNotice error={connectionError} updatedAt={current.updatedAt || queues.updatedAt || me.updatedAt}
        refreshing={me.refreshing || queues.refreshing || current.refreshing}
        retry={() => Promise.all([me.refresh(), queues.refresh(), refresh()])} />
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {user?.role === "owner"
              ? "ВЛАДЕЛЕЦ СИСТЕМЫ"
              : "ПАНЕЛЬ ПРЕПОДАВАТЕЛЯ"}
          </div>
          <h1>
            {tab === "teachers"
              ? "Преподаватели"
              : tab === "qr"
                ? "QR и ссылка для вашей пары"
                : tab === "settings"
                  ? "Настройки пары"
                  : (data?.settings.title || "Ваши очереди")}
          </h1>
          <p>
            {tab === "teachers"
              ? "Добавляйте коллег и управляйте их доступом."
              : data ? [data.settings.room, data.settings.teacherName].filter(Boolean).join(" · ")
                : "Создайте очередь и покажите QR студентам."}
          </p>
        </div>
        {tab !== "teachers" && (
          <Button tone="secondary" onClick={() => setCreate(true)} disabled={!user || busy || !!connectionError}>
            <Plus size={17} />
            Создать очередь
          </Button>
        )}
      </div>
      <ErrorBox error={actionError} />
      {tab === "teachers" && user?.role === "owner" ? (
        <Teachers notify={notify} baseUrl={baseUrl} />
      ) : (
        <>
          {queues.data?.queues.length > 1 && (
            <div className="queue-selector panel">
              <label>
                Текущая очередь
                <select
                  aria-label="Текущая очередь"
                  value={qid || ""}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    storage.set("campus.selected.v2", e.target.value);
                    setHistoryView(false);
                    setActionError("");
                  }}
                >
                  {queues.data.queues.map((q) => (
                    <option key={q.id} value={q.id}>
                      {[q.title, q.teacherName, q.room].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {!qid ? (
            <section className="panel">
              <Empty
                title={
                  queues.data ? "Нет активных очередей" : "Подключаемся…"
                }
              >
                Укажите название занятия. Сразу после создания
                появится QR для студентов.
              </Empty>
            </section>
          ) : !data ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              Загружаем очередь…
            </div>
          ) : tab === "settings" ? (
            <Settings
              data={data}
              act={act}
              disabled={disabled}
              startNew={() =>
                setResetGeneration({
                  queueId: qid,
                  generation: data.settings.generation,
                })
              }
            />
          ) : tab === "qr" ? (
            <QRSettings
              data={data}
              baseUrl={baseUrl}
              setBaseUrl={setBaseUrl}
              displayUrl={displayUrl}
              onCreateLink={() => setInviteLinkOpen(true)}
              linkDisabled={disabled || data.settings.status !== "open" || !data.settings.teacherActive}
              notify={notify}
            />
          ) : (
            <>
              <div className="teacher-summary">
                <Status status={data.settings.status} disabled={!data.settings.teacherActive} />
                <span>Ожидают <strong>{data.stats.waiting}</strong></span>
                <span>Сдали <strong>{data.stats.completed}</strong></span>
              </div>
              <div className="admin-grid">
                <div>
                  <section className={`admin-current ${data.current ? "is-serving" : ""}`}>
                    <div className="current-top">
                      <span className="eyebrow">СЕЙЧАС НА ПРИЁМЕ</span>
                      <span className="current-tag">
                        {data.current ? "Идёт сдача" : "Можно вызвать"}
                      </span>
                    </div>
                    <div className="current-person">
                      <span className="admin-number">
                        {data.current?.number || <AppIcon name="ticket" />}
                      </span>
                      <div>
                        <h2>{data.current?.name || "Готовы принимать?"}</h2>
                        <p>
                          {data.current
                            ? `Вызван в ${time(data.current.calledAt)}`
                            : data.settings.title}
                        </p>
                      </div>
                    </div>
                    <div className="current-buttons">
                      {data.current ? (
                        <>
                          <Button
                            tone="light"
                            disabled={disabled}
                            onClick={() =>
                              act(
                                "/next",
                                { currentTicketId: data.current.id },
                                (result) => result.current ? "Следующий студент вызван." : "Приём завершён. Ожидающих студентов нет.",
                              )
                            }
                          >
                            <Play size={18} />
                            Вызвать следующего
                          </Button>
                          <Button
                            tone="transparent"
                            disabled={disabled}
                            onClick={() =>
                              act(
                                `/tickets/${data.current.id}/finish`,
                                { status: "skipped" },
                                "Студент пропущен.",
                              )
                            }
                          >
                            <SkipForward size={17} />
                            Не пришёл
                          </Button>
                        </>
                      ) : (
                        <Button
                          tone="light"
                          disabled={disabled || !data.stats.waiting}
                          onClick={() =>
                            act("/next", undefined, "Следующий студент вызван.")
                          }
                        >
                          <Play size={17} />
                          Вызвать следующего
                        </Button>
                      )}
                    </div>
                  </section>
                  <section className="panel queue-panel">
                    <div className="queue-toolbar">
                      <div
                        className="tab-list"
                        role="tablist"
                        aria-label="Список студентов"
                      >
                        <button
                          role="tab"
                          aria-selected={!historyView}
                          className={!historyView ? "selected" : ""}
                          onClick={() => setHistoryView(false)}
                        >
                          В очереди{" "}
                          <span>
                            {data.stats.waiting + (data.current ? 1 : 0)}
                          </span>
                        </button>
                        <button
                          role="tab"
                          aria-selected={historyView}
                          className={historyView ? "selected" : ""}
                          onClick={() => setHistoryView(true)}
                        >
                          Уже приняли
                        </button>
                      </div>
                      <button className="manual-entry-button" type="button"
                        disabled={disabled || data.settings.status !== "open" || !data.settings.teacherActive}
                        onClick={() => setManualQueue(data.settings)}>
                        <Plus size={16} /> Добавить студента
                      </button>
                    </div>
                    {tickets.length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Номер</th>
                              <th>Студент</th>
                              <th>Записался</th>
                              <th>Статус</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tickets.map((t) => (
                              <tr
                                key={t.id}
                                className={
                                  t.status === "called" ? "called-row" : ""
                                }
                              >
                                <td>
                                  <span className="number-pill">
                                    {t.number}
                                  </span>
                                </td>
                                <td>
                                  <strong>{t.name}</strong>
                                  {t.status === "done" && <span className="student-group">Приём: {durationLabel(serviceSeconds(t))}</span>}
                                </td>
                                <td className="muted">{time(t.createdAt)}</td>
                                <td>
                                  <span className={`ticket-status ${t.status}`}>
                                    {statusNames[t.status]}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title={
                          historyView ? "История пока пуста" : "Здесь пока тихо"
                        }
                      >
                        {historyView
                          ? "Завершённые талоны появятся здесь."
                          : "Покажите QR первым студентам. Затем они смогут поделиться кодом друг с другом."}
                      </Empty>
                    )}
                  </section>
                </div>
                <aside className="admin-aside">
                  <section className="panel qr-panel">
                    <div className="section-title">
                      <QrCode size={19} />
                      <h3>QR для студентов</h3>
                    </div>
                    <LiveQR
                      queueId={qid}
                      generation={data.settings.generation} qrIntervalSeconds={data.settings.qrIntervalSeconds}
                      title={data.settings.title}
                      subtitle={data.settings.teacherName}
                      admin
                      baseUrl={baseUrl}
                      enabled={
                        data.settings.status === "open" &&
                        data.settings.teacherActive &&
                        !error
                      }
                    />
                    <Button tone="secondary" className="wide invite-link-trigger"
                      disabled={disabled || data.settings.status !== "open" || !data.settings.teacherActive}
                      onClick={() => setInviteLinkOpen(true)}><Link2 size={18} /> Ссылка для записи</Button>
                    <p className="small muted">QR и ссылка работают одновременно.</p>
                    {displayUrl && (
                      <a
                        href={displayUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-link"
                      >
                        Открыть табло <ArrowUpRight size={14} />
                      </a>
                    )}
                  </section>
                  <Button
                    tone="secondary"
                    className="wide"
                    disabled={disabled}
                    onClick={() =>
                      act(
                        "/settings",
                        {
                          status:
                            data.settings.status === "open" ? "paused" : "open",
                        },
                        "Статус записи изменён.",
                        "PATCH",
                      )
                    }
                  >
                    {data.settings.status === "open" ? (
                      <Pause size={16} />
                    ) : (
                      <Play size={16} />
                    )}{" "}
                    {data.settings.status === "open"
                      ? "Пауза записи"
                      : "Открыть запись"}
                  </Button>
                  <div className="queue-end-action">
                    <Button tone="danger" className="wide" disabled={disabled}
                      onClick={() => { setActionError(""); setEndTarget({ id: qid, generation: data.settings.generation, title: data.settings.title, waiting: data.stats.waiting + Number(!!data.current) }); }}>
                      Завершить очередь
                    </Button>
                    <p>Когда закончили принимать работы</p>
                  </div>
                </aside>
              </div>
              <details className="teacher-analytics panel">
                <summary>Статистика приёма</summary>
              <div className="metrics">
                <Metric
                  artwork="ticket"
                  label="В очереди"
                  value={data.stats.waiting}
                  detail="ждут своего вызова"
                  color="purple"
                />
                <Metric
                  artwork="teacher"
                  label="Уже сдали"
                  value={data.stats.completed}
                  detail="за текущую пару"
                  color="green"
                />
                <Metric
                  artwork="clock"
                  label="Ожидание последнего"
                  value={
                    estimateMinutes(data.stats.waiting + (data.current ? 1 : 0), data.analytics) ?? "—"
                  }
                  unit={estimateMinutes(data.stats.waiting + (data.current ? 1 : 0), data.analytics) == null ? "" : "мин"}
                  detail={data.analytics?.sampleCount ? "по фактическому времени приёма" : "оценка после первого приёма"}
                  color="orange"
                />
              </div>
              <p className="analytics-note">
                <Clock3 size={16} />
                <span>{data.analytics?.sampleCount
                  ? `Средний приём: ${durationLabel(data.analytics.averageSeconds)} · Завершённых приёмов: ${data.analytics.sampleCount}.`
                  : "Пока нет завершённых приёмов — среднее время ещё неизвестно."}
                {" "}Пропуски и отмены не учитываются.</span>
              </p>
              </details>
            </>
          )}
        </>
      )}
      {inviteLinkOpen && data && <InviteLinkDialog key={`${qid}-${data.settings.generation}`}
        queue={data.settings} baseUrl={baseUrl}
        created={inviteLinks[inviteLinkKey] ?? null}
        onCreated={(link) => setInviteLinks((previous) => ({ ...previous, [inviteLinkKey]: link }))}
        blocked={disabled || data.settings.status !== "open" || !data.settings.teacherActive}
        onClose={() => setInviteLinkOpen(false)} />}
      {showPassword && <PasswordChange user={user} onClose={closePassword} onChanged={passwordChanged} />}
      {manualQueue && <ManualEnrollment queue={manualQueue} blocked={!!connectionError} onClose={() => setManualQueue(null)}
        onAdded={async ticket => {
          await Promise.all([refresh(), queues.refresh()]);
          notify(`Талон ${ticket.number} готов.`);
        }} />}
      {endTarget && (
        <Dialog title="Завершить очередь?" onClose={() => { if (!busy) setEndTarget(null); }}>
          <p><strong>{endTarget.title}</strong></p>
          <p>Очередь исчезнет из панели. Все студенты увидят, что приём завершён. Открыть эту очередь снова нельзя.</p>
          {!!endTarget.waiting && <p className="end-warning">В очереди ещё {endTarget.waiting} чел., включая текущего студента.</p>}
          <ErrorBox error={actionError} />
          <div className="dialog-actions">
            <Button tone="secondary" autoFocus disabled={busy} onClick={() => setEndTarget(null)}>Продолжить приём</Button>
            <Button tone="danger" disabled={busy || !!connectionError} onClick={endCurrentQueue}>{busy ? "Завершаем…" : "Да, завершить очередь"}</Button>
          </div>
        </Dialog>
      )}
      {create && (
        <Dialog title="Новая очередь" onClose={() => setCreate(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const values = new FormData(e.currentTarget);
              setBusy(true);
              setActionError("");
              try {
                const result = await request("/admin/queues", {
                  admin: true,
                  method: "POST",
                  body: {
                    title: values.get("title"),
                    qrIntervalSeconds: Number(values.get("qrIntervalMinutes")) * 60,
                  },
                });
                await queues.refresh();
                setSelected(result.queue.id);
                storage.set("campus.selected.v2", result.queue.id);
                setTab("queue");
                setCreate(false);
                notify("Очередь создана. QR готов.");
              } catch (err) {
                setActionError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Название занятия
              <input
                name="title"
                required
                maxLength={80}
                placeholder="Лабораторная № 3 · Базы данных"
              />
            </label>
            <MinuteIntervalField disabled={busy} />
            <ErrorBox error={actionError} />
            <Button className="wide" disabled={busy}>
              <Plus size={18} />
              Создать очередь
            </Button>
          </form>
        </Dialog>
      )}
      {resetGeneration !== null && data && (
        <Dialog
          title="Начать новую пару?"
          onClose={() => setResetGeneration(null)}
        >
          <p>
            Активные талоны только этой очереди будут отменены. Остальные
            очереди и преподаватели продолжат работу.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act(
                  "/reset",
                  {
                    confirmation: new FormData(e.currentTarget).get(
                      "confirmation",
                    ),
                    generation: resetGeneration.generation,
                  },
                  "Новая пара начата.",
                  "POST",
                  resetGeneration.queueId,
                )
              )
                setResetGeneration(null);
            }}
          >
            <label>
              Введите НОВАЯ ПАРА
              <input
                name="confirmation"
                required
                pattern="НОВАЯ ПАРА"
                autoComplete="off"
              />
            </label>
            <ErrorBox error={actionError} />
            <Button tone="danger" disabled={disabled}>
              Начать новую пару
            </Button>
          </form>
        </Dialog>
      )}
    </Shell>
  );
}
function Settings({ data, act, disabled, startNew }) {
  return (
    <div className="settings-grid">
      <section className="panel settings-panel">
        <h2>{data.settings.title}</h2>
        <p className="muted">Преподаватель: {data.settings.teacherName}</p>
        <form
          key={`${data.settings.id}-${data.settings.generation}`}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            act(
              "/settings",
              {
                title: f.get("title"),
                room: f.get("room"),
                maxQueue: Number(f.get("maxQueue")),
                qrIntervalSeconds: Number(f.get("qrIntervalMinutes")) * 60,
                status: f.get("status"),
              },
              "Настройки сохранены.",
              "PATCH",
            );
          }}
        >
          <label>
            Название занятия
            <input
              name="title"
              defaultValue={data.settings.title}
              required
              maxLength={80}
            />
          </label>
          <label>
            Место сдачи (необязательно)
            <input
              name="room"
              defaultValue={data.settings.room}
              maxLength={60}
            />
          </label>
          <div className="form-columns">
            <label>
              Максимум в очереди
              <input
                name="maxQueue"
                type="number"
                min="1"
                max="500"
                defaultValue={data.settings.maxQueue}
                required
              />
            </label>
          </div>
          <MinuteIntervalField initialSeconds={data.settings.qrIntervalSeconds} disabled={disabled} />
          <label>
            Запись
            <select name="status" defaultValue={data.settings.status}>
              <option value="open">Открыта</option>
              <option value="paused">Приостановлена</option>
              <option value="closed">Закрыта</option>
            </select>
          </label>
          <p className="small muted">
            Пауза останавливает новые записи и выдачу QR, но сохраняет талоны.
          </p>
          <Button disabled={disabled}>
            <Check size={18} />
            Сохранить настройки
          </Button>
        </form>
      </section>
      <section className="panel new-session">
        <span className="square-icon">
          <AppIcon name="teacher" />
        </span>
        <h2>Следующая пара</h2>
        <p>
          Начните нумерацию заново для этой очереди. Старые QR и незавершённые
          формы записи перестанут действовать.
        </p>
        <Button tone="secondary" disabled={disabled} onClick={startNew}>
          <Plus size={17} />
          Начать новую пару
        </Button>
        <p className="small muted">
          Для параллельного занятия создайте отдельную очередь.
        </p>
      </section>
    </div>
  );
}
function QRSettings({ data, baseUrl, setBaseUrl, displayUrl, notify, onCreateLink, linkDisabled }) {
  const [draft, setDraft] = useState(baseUrl),
    [error, setError] = useState("");
  const network = useResource("/admin/network", { admin: true, poll: 0 });
  useEffect(() => setDraft(baseUrl), [baseUrl]);
  return (
    <div className="qr-settings-grid">
      <section className="panel qr-poster">
        <div className="eyebrow">{data.settings.teacherName}</div>
        <h2>{data.settings.title}</h2>
        <LiveQR
          queueId={data.settings.id}
          generation={data.settings.generation} qrIntervalSeconds={data.settings.qrIntervalSeconds}
          title={data.settings.title}
          subtitle={data.settings.teacherName}
          admin
          baseUrl={baseUrl}
          enabled={
            data.settings.status === "open" && data.settings.teacherActive
          }
        />
        <Button tone="secondary" className="wide invite-link-trigger" disabled={linkDisabled} onClick={onCreateLink}>
          <Link2 size={18} /> Ссылка для записи
        </Button>
        <p className="small muted">QR и ссылка работают одновременно.</p>
        <p>
          После записи студенты смогут
          <br />
          показывать свежий QR друг другу.
        </p>
        {displayUrl && (
          <a
            className="text-link"
            href={displayUrl}
            target="_blank"
            rel="noreferrer"
          >
            Табло для проектора <ArrowUpRight size={15} />
          </a>
        )}
      </section>
      <section className="panel settings-panel">
        <h2>Адрес сайта для телефонов</h2>
        <p className="muted">
          Приглашение добавляется в QR автоматически. Интервал обновления — {Math.round((data.settings.qrIntervalSeconds || 60) / 60)} мин.
          Его можно изменить в настройках очереди.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (cloudEnabled) return;
            try {
              const url = new URL(draft);
              if (
                !["http:", "https:"].includes(url.protocol) ||
                url.username ||
                url.password
              )
                throw new Error();
              url.hash = "";
              url.search = "";
              setBaseUrl(url.href);
              storage.set("campus.link.v1", url.href);
              notify("Адрес QR обновлён.");
              setError("");
            } catch {
              setError("Введите полный адрес сайта http:// или https://.");
            }
          }}
        >
          <label>
            Адрес сайта
            <input
              type="url"
              readOnly={cloudEnabled}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              required
              maxLength={500}
            />
          </label>
          {["localhost", "127.0.0.1"].includes(location.hostname) && (
            <div className="network-options">
              <span>Адреса этого компьютера:</span>
              {network.data?.addresses.map((ip) => (
                <button
                  type="button"
                  key={ip}
                  onClick={() =>
                    setDraft(
                      `${location.protocol}//${ip}:${location.port}${location.pathname}`,
                    )
                  }
                >
                  {ip}
                </button>
              ))}
            </div>
          )}
          {cloudEnabled ? (
            <p className="small muted">Адрес очереди закреплён за этим сайтом. Все QR ведут в этот проект.</p>
          ) : <Button>Сохранить адрес</Button>}
        </form>
        <ErrorBox error={error} />
        {!cloudEnabled && <div className="qr-instructions">
          <Wifi size={21} />
          <div>
            <h3>Для локальной проверки</h3>
            <p>
              Телефон и компьютер должны быть в одной доступной сети. localhost
              на телефоне ведёт на сам телефон.
            </p>
          </div>
        </div>}
        <div className="security-note">
          <ShieldCheck size={20} />
          <div>
            <strong>Что даёт смена QR</strong>
            <p>
              Старая фотография не позволяет записаться. Но свежий код можно
              мгновенно переслать: это ограничение срока приглашения, а не
              доказательство присутствия.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
function Teachers({ notify, baseUrl }) {
  const resource = useResource("/admin/teachers", { admin: true, poll: 5000 });
  const [creating, setCreating] = useState(false),
    [credentials, setCredentials] = useState(null),
    [confirm, setConfirm] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function change(teacher, body) {
    setBusy(true);
    setError("");
    try {
      const result = await request(`/admin/teachers/${teacher.id}`, {
        admin: true,
        method: "PATCH",
        body,
      });
      await resource.refresh();
      if (result.password) setCredentials(result);
      setConfirm(null);
      notify(
        result.password
          ? "Новый пароль создан."
          : "Доступ преподавателя изменён.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="teachers-heading">
        <p className="muted">
          Преподаватель видит и изменяет только свои очереди.
        </p>
        <Button onClick={() => setCreating(true)}>
          <Plus size={17} />
          Добавить преподавателя
        </Button>
      </div>
      <ConnectionNotice {...resource} retry={resource.refresh} />
      <ErrorBox error={error} />
      <section className="panel">
        {resource.data?.teachers.length ? (
          <div className="teacher-list">
            {resource.data.teachers.map((t) => (
              <article className="teacher-row" key={t.id}>
                <span className="square-icon">
                  <AppIcon name="teacher" />
                </span>
                <div className="teacher-info">
                  <h3>{t.name}</h3>
                  <p>
                    {t.username} ·{" "}
                    {t.active ? "Доступ открыт" : "Аккаунт отключён"}
                  </p>
                </div>
                <div className="teacher-actions">
                  <Button
                    tone="secondary"
                    disabled={busy}
                    onClick={() =>
                      setConfirm({ teacher: t, action: "password" })
                    }
                  >
                    Выдать временный пароль
                  </Button>
                  <Button
                    tone={t.active ? "ghost" : "soft"}
                    disabled={busy}
                    onClick={() =>
                      t.active
                        ? setConfirm({ teacher: t, action: "disable" })
                        : change(t, { active: true })
                    }
                  >
                    {t.active ? "Отключить" : "Включить"}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="Подключите первого коллегу">
            Вы создадите логин и получите случайный пароль. Передайте их
            преподавателю лично.
          </Empty>
        )}
      </section>
      {creating && (
        <Dialog
          title="Добавить преподавателя"
          onClose={() => setCreating(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                const result = await request("/admin/teachers", {
                  admin: true,
                  method: "POST",
                  body: { name: f.get("name"), username: f.get("username") },
                });
                await resource.refresh();
                setCreating(false);
                setCredentials(result);
              } catch (err) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Имя преподавателя
              <input
                name="name"
                required
                maxLength={80}
                placeholder="Анна Сергеевна"
              />
            </label>
            <label>
              Логин
              <input
                name="username"
                required
                minLength={3}
                maxLength={32}
                pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]{2,31}"
                placeholder="anna.sergeeva"
                autoComplete="off"
              />
            </label>
            <p className="small muted">
              Пароль будет создан автоматически и показан один раз.
            </p>
            <ErrorBox error={error} />
            <Button className="wide" disabled={busy}>
              Создать аккаунт
            </Button>
          </form>
        </Dialog>
      )}
      {credentials && (
        <Dialog
          title="Доступ преподавателя"
          onClose={() => setCredentials(null)}
        >
          <p>{credentials.user.name}</p>
          <label>
            Логин
            <input readOnly value={credentials.user.username} />
          </label>
          <label>
            Временный пароль
            <input readOnly value={credentials.password} />
          </label>
          <p className="small muted">
            Сохраните и передайте данные преподавателю. После закрытия пароль
            повторно не показывается; при необходимости можно создать новый.
            {" "}При входе преподаватель должен будет задать свой пароль.
          </p>
          <Button
            className="wide"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `Вход: ${baseUrl.split("#")[0]}#/admin\nЛогин: ${credentials.user.username}\nПароль: ${credentials.password}`,
                );
                notify("Данные скопированы.");
              } catch {
                setError("Выделите логин и пароль и скопируйте вручную.");
              }
            }}
          >
            <Copy size={17} />
            Скопировать данные
          </Button>
          <ErrorBox error={error} />
        </Dialog>
      )}
      {confirm && (
        <Dialog
          title={
            confirm.action === "disable"
              ? "Отключить преподавателя?"
              : "Выдать временный пароль?"
          }
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm.teacher.name}:{" "}
            {confirm.action === "disable"
              ? "вход и новые записи в его очереди будут остановлены. Существующие талоны сохранятся."
              : "старый пароль перестанет работать, входы на других устройствах завершатся. Передайте преподавателю временный пароль: при входе он обязательно задаст свой. Очереди и талоны сохранятся."}
          </p>
          <ErrorBox error={error} />
          <div className="dialog-actions">
            <Button tone="secondary" onClick={() => setConfirm(null)}>
              Отмена
            </Button>
            <Button
              tone="danger"
              disabled={busy}
              onClick={() =>
                change(
                  confirm.teacher,
                  confirm.action === "disable"
                    ? { active: false }
                    : { resetPassword: true },
                )
              }
            >
              Подтвердить
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
function Screen({ queueId, displayToken }) {
  const resource = useResource(`/queues/${queueId}`), { data, error } = resource;
  const [baseUrl] = useState(savedBase);
  if (data?.settings.endedAt) return <StudentPage ended><QueueEnded settings={data.settings} /></StudentPage>;
  return (
    <div className={`screen-page ${data?.current && !error ? "screen-serving" : ""}`}>
      <header>
        <a href="#/" className="brand-link">
          <Brand />
        </a>
        <span>
          {[data?.settings.title, data?.settings.teacherName, data?.settings.room].filter(Boolean).join(" / ")}
        </span>
        {data && (
          <Status
            status={data.settings.status}
            disabled={!data.settings.teacherActive}
          />
        )}
      </header>
      <ConnectionNotice {...resource} retry={resource.refresh} />
      <main className="screen-grid">
        <section className="screen-current">
          <div className="eyebrow">
            {error ? "ПОСЛЕДНИЙ ПОЛУЧЕННЫЙ ВЫЗОВ" : "ПРИГЛАШАЕМ НА СДАЧУ"}
          </div>
          <h1>{data?.current?.number || "—"}</h1>
          <p>
            {data?.current
              ? "Подойдите к преподавателю"
              : "Ожидайте вызова вашего номера"}
          </p>
          <div className="screen-next">
            <span>Следующие</span>
            <div>
              {data?.nextNumbers.length ? (
                data.nextNumbers.map((n) => <strong key={n}>{n}</strong>)
              ) : (
                <span>Очередь пока пуста</span>
              )}
            </div>
          </div>
        </section>
        <section className="screen-qr">
          <span className="eyebrow">ЗАПИСЬ В ОЧЕРЕДЬ</span>
          <h2>
            Наведите камеру.
            <br />
            Займите своё место.
          </h2>
          {displayToken && data ? (
            <LiveQR
              queueId={queueId}
              generation={data.settings.generation} qrIntervalSeconds={data.settings.qrIntervalSeconds}
              title={data.settings.title}
              subtitle={data.settings.teacherName}
              displayToken={displayToken}
              baseUrl={baseUrl}
              enabled={
                data.settings.status === "open" &&
                data.settings.teacherActive &&
                !error
              }
            />
          ) : (
            <p>Для показа QR откройте табло из панели преподавателя.</p>
          )}
          <p>
            Свежий QR можно также попросить
            <br />у одногруппника с активным талоном.
          </p>
        </section>
      </main>
      <footer>
        <span>
          <Users size={18} />В очереди: {data?.stats.waiting ?? "—"}
        </span>
        <span>Талоны не меняются при обновлении QR</span>
        <a href="#/admin">Панель преподавателя</a>
      </footer>
    </div>
  );
}
function LaunchPage() {
  return (
    <div className="launch-page">
      <header className="launch-header">
        <a href="#/" className="brand-link"><Brand /></a>
        <span className="launch-status"><span />Готовимся к запуску</span>
      </header>
      <main className="launch-main">
        <div className="launch-intro">
          <span className="eyebrow">СДАЧА РАБОТ БЕЗ СУЕТЫ</span>
          <h1>На пару.<br />В свою очередь.</h1>
          <p>Отсканируй QR, займи место и следи за своим номером. У каждого преподавателя — своя очередь.</p>
          <div className="launch-notice" role="status">
            <Clock3 size={23} />
            <div><strong>Запись пока недоступна</strong><p>Подготавливаем сервис. Когда очередь заработает, преподаватель покажет QR-код для вашей пары.</p></div>
          </div>
        </div>
        <section className="launch-steps" aria-label="Как это будет работать">
          <div className="launch-icon"><GraduationCap size={34} /></div>
          <h2>Меньше ожидания.<br />Больше порядка.</h2>
          <ol>
            <li><QrCode size={23} /><div><strong>Открой очередь по QR</strong><p>Попроси код у преподавателя или одногруппника.</p></div></li>
            <li><Ticket size={23} /><div><strong>Получи свой номер</strong><p>Укажи имя — и ты в очереди.</p></div></li>
            <li><Users size={23} /><div><strong>Подойди, когда вызовут</strong><p>Следи за своим местом на телефоне.</p></div></li>
          </ol>
        </section>
      </main>
      <footer className="launch-footer">РИТМ · онлайн-очередь на сдачу работ</footer>
    </div>
  );
}
createRoot(document.getElementById("root")).render(
  import.meta.env.VITE_DEPLOY_PENDING === "true" ? <LaunchPage /> : <App />,
);
