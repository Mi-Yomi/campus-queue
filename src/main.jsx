import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  Clock3,
  Copy,
  GraduationCap,
  LayoutDashboard,
  ListOrdered,
  LoaderCircle,
  LogOut,
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
  Volume2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { request, storage, visitorStorageAvailable, cloudEnabled } from "./api";
import { queueBase } from "./queue-links.mjs";
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
function readDraft(id) {
  try {
    return JSON.parse(storage.get(`campus.draft.v2.${id}`) || "{}");
  } catch {
    return {};
  }
}
function Shell({
  children,
  admin = false,
  user,
  tab,
  setTab,
  onLogout,
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
                <LayoutDashboard size={19} />
                Мои очереди
              </button>
              <button
                className={tab === "qr" ? "active" : ""}
                onClick={() => setTab("qr")}
              >
                <QrCode size={19} />
                QR-код для записи
              </button>
              <button
                className={tab === "settings" ? "active" : ""}
                onClick={() => setTab("settings")}
              >
                <Settings2 size={19} />
                Настройки пары
              </button>
              {user?.role === "owner" && (
                <button
                  className={tab === "teachers" ? "active" : ""}
                  onClick={() => setTab("teachers")}
                >
                  <Users size={19} />
                  Преподаватели
                </button>
              )}
              {displayUrl && (
                <a href={displayUrl} target="_blank" rel="noreferrer">
                  <Monitor size={19} />
                  Табло аудитории
                  <ArrowUpRight size={15} />
                </a>
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
            <ShieldCheck size={21} />
            <span>
              {admin ? user?.name : "Талон остаётся с вами"}
              <span>
                {admin
                  ? "Очереди преподавателей независимы."
                  : "Обновление QR не меняет ваше место в очереди."}
              </span>
            </span>
          </div>
          {admin ? (
            <button className="sidebar-account" onClick={onLogout}>
              <LogOut size={18} />
              Выйти из панели
            </button>
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
          <span>по порядку · очередь на пару</span>
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
  const { data, error } = useResource("/me/tickets");
  return (
    <Shell data={data} error={error}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">СТУДЕНТ</div>
          <h1>Ваши талоны</h1>
          <p>Очереди разных преподавателей — в одном месте.</p>
        </div>
      </div>
      <ErrorBox error={error} />
      <section className="panel home-scan">
        <span className="square-icon">
          <QrCode size={26} />
        </span>
        <div>
          <h2>Отсканируйте свежий QR</h2>
          <p>
            Код можно попросить у преподавателя или у одногруппника, который уже
            стоит в очереди. Он обновляется каждые 20 секунд.
          </p>
        </div>
      </section>
      {data?.tickets.length ? (
        <div className="queue-card-grid">
          {data.tickets.map((t) => (
            <a
              key={t.id}
              className="panel class-card"
              href={`#/q/${t.queueId}`}
            >
              <div className="class-card-top">
                <span className={`ticket-status ${t.status}`}>
                  {statusNames[t.status]}
                </span>
                <span className="number-pill">{t.number}</span>
              </div>
              <h2>{t.queue.title}</h2>
              <p>{t.queue.teacherName}</p>
              <span className="muted small">
                <MapPin size={13} /> {t.queue.room}
              </span>
            </a>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty title={data ? "Вы пока не записаны" : "Загружаем талоны…"}>
            После записи талон появится здесь и останется после перезагрузки
            страницы в этом браузере.
          </Empty>
        </section>
      )}
      <p className="privacy-footnote">
        Не очищайте данные сайта до конца пары. При переходе на другой адрес или
        в другой браузер сохранённый талон не переносится автоматически.
      </p>
    </Shell>
  );
}
function Visitor({ queueId, invite, notify }) {
  const resource = useResource(`/queues/${queueId}`),
    { data, error, refresh } = resource;
  const [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(""),
    [share, setShare] = useState(false),
    [confirm, setConfirm] = useState(false),
    [draft, setDraft] = useState(() => readDraft(queueId)),
    [redeeming, setRedeeming] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const handled = useRef(null),
    audio = useRef(null),
    previous = useRef(null),
    [sound, setSound] = useState(false),
    [nowTick, setNowTick] = useState(Date.now());
  const active = activeTicket(data?.mine),
    mine = data?.mine;
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
    if (!data || !invite || handled.current === invite || error) return;
    if (
      active ||
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
    queueId,
    error,
    refresh,
  ]);
  useEffect(() => {
    if (
      mine?.status === "called" &&
      previous.current &&
      previous.current !== "called" &&
      sound &&
      audio.current
    ) {
      const ctx = audio.current,
        osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 740;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
      osc.start();
      osc.stop(ctx.currentTime + 0.7);
    }
    if (mine) previous.current = mine.status;
    document.title =
      mine?.status === "called"
        ? "Вас вызывают! — По порядку"
        : "По порядку — очередь на пару";
  }, [mine?.status, sound]);
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
  };
  return (
    <Shell data={data} error={error}>
      <a className="back-link" href="#/">
        Все мои талоны
      </a>
      <ErrorBox error={error}>
        {data ? " На экране последние полученные данные." : ""}
      </ErrorBox>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {data?.settings.teacherName || "ОЧЕРЕДЬ НА СДАЧУ"}
          </div>
          <h1>{active ? "Ваш талон" : "Запись на сдачу"}</h1>
          <p>QR меняется. Ваше место в очереди сохраняется.</p>
        </div>
        {data && (
          <Status
            status={data.settings.status}
            disabled={!data.settings.teacherActive}
          />
        )}
      </div>
      {!data ? (
        <div className="loading">
          <LoaderCircle className="spin" />
          Загружаем очередь…
        </div>
      ) : (
        <div className="visitor-grid">
          <section
            className={`panel join-panel ${mine?.status === "called" ? "called-panel" : ""}`}
          >
            <div className="section-heading">
              <span className="square-icon">
                <GraduationCap size={22} />
              </span>
              <div>
                <h2>{data.settings.title}</h2>
                <p>
                  <MapPin size={14} />
                  {data.settings.room}
                </p>
              </div>
              <span className="session-chip">
                Пара {data.settings.generation}
              </span>
            </div>
            {active ? (
              <>
                <div className="ticket-display" aria-live="polite">
                  <div className="eyebrow">
                    {mine.status === "called" ? "ВАС ВЫЗЫВАЮТ" : "ВАШ НОМЕР"}
                  </div>
                  <div className="ticket-number">{mine.number}</div>
                  <h3>
                    {mine.status === "called"
                      ? "Подходите к преподавателю"
                      : "Вы в очереди. Всё готово."}
                  </h3>
                  <p>
                    {mine.name}
                  </p>
                </div>
                <div className="ticket-stats">
                  <div>
                    <span>Перед вами</span>
                    <strong>
                      {mine.ahead} <small>чел.</small>
                    </strong>
                  </div>
                  <div>
                    <span>Примерное ожидание</span>
                    <strong>
                      {mine.status === "called"
                        ? "Сейчас"
                        : mine.ahead === 0 ? "Вы следующий"
                          : mine.estimatedMinutes == null ? "Пока нет данных"
                          : `~ ${mine.estimatedMinutes} мин`}
                    </strong>
                  </div>
                </div>
                <Button
                  className="wide share-qr-button"
                  disabled={!data.canShare || !!error}
                  onClick={() => setShare(true)}
                >
                  <QrCode size={20} />
                  Показать QR одногруппнику
                </Button>
                <div className="ticket-help">
                  <ShieldCheck size={18} />
                  <span>
                    Можно обновить страницу или закрыть QR. Ваш талон останется
                    в этом браузере.
                  </span>
                </div>
                <div className="ticket-actions">
                  <Button
                    tone={sound ? "soft" : "secondary"}
                    onClick={async () => {
                      try {
                        if (!audio.current)
                          audio.current = new (
                            window.AudioContext || window.webkitAudioContext
                          )();
                        await audio.current.resume();
                        setSound(!sound);
                      } catch {
                        setActionError("Звук недоступен в этом браузере.");
                      }
                    }}
                  >
                    <Volume2 size={17} />
                    {sound ? "Звук включён" : "Включить звук"}
                  </Button>
                  <Button
                    tone="ghost"
                    disabled={busy || !!error}
                    onClick={() => setConfirm(true)}
                  >
                    Выйти из очереди
                  </Button>
                </div>
                <p className="small muted">
                  Сигнал работает, пока браузер активен.
                </p>
              </>
            ) : (
              <>
                {mine && (
                  <div className="finished-message">
                    <CheckCheck size={20} />
                    <span>
                      {mine.previousSession
                        ? "Началась новая пара. Для новой записи нужен свежий QR."
                        : mine.status === "done"
                          ? "Работа сдана. До следующей пары!"
                          : mine.status === "skipped"
                            ? "Ваш номер пропущен. Для повторной записи нужен свежий QR."
                            : "Вы вышли из очереди. Для повторной записи нужен свежий QR."}
                    </span>
                  </div>
                )}
                {redeeming ? (
                  <div className="loading">
                    <LoaderCircle className="spin" />
                    Проверяем QR…
                  </div>
                ) : data.admission && seconds > 0 ? (
                  <>
                    <div className="admission-banner">
                      <ShieldCheck size={19} />
                      <div>
                        <strong>QR подтверждён · осталось {seconds} с</strong>
                        <p>
                          Спокойно заполните форму. Новый QR сканировать не
                          нужно. Место займётся после нажатия кнопки.
                        </p>
                      </div>
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        act("/join", {
                          name: draft.name || "",
                          grantId: data.admission.id,
                        });
                      }}
                    >
                      <label>
                        Имя и фамилия
                        <input
                          name="name"
                          required
                          maxLength={60}
                          autoComplete="name"
                          placeholder="Например, Алина Ким"
                          value={draft.name || ""}
                          onChange={(e) => change("name", e.target.value)}
                        />
                      </label>
                      <div className="form-note">
                        <ShieldCheck size={18} />
                        <span>
                          Имя увидит только преподаватель. На табло —
                          только номер.
                        </span>
                      </div>
                      <Button
                        className="wide"
                        disabled={
                          busy ||
                          !!error ||
                          data.settings.status !== "open" ||
                          !data.settings.teacherActive ||
                          seconds <= 0
                        }
                      >
                        <Plus size={18} />
                        {busy ? "Записываем…" : "Занять место в очереди"}
                      </Button>
                    </form>
                  </>
                ) : (
                  <div className="scan-required">
                    <QrCode size={36} />
                    <h3>Нужен свежий QR-код</h3>
                    <p>
                      Попросите преподавателя или одногруппника с активным
                      талоном показать код на телефоне. Отсканируйте его
                      камерой.
                    </p>
                    <span className="small muted">
                      Коды действуют 20 секунд. Уже выданные талоны не истекают
                      вместе с QR.
                    </span>
                  </div>
                )}
              </>
            )}
            {actionError && (
              <p className="field-error" role="alert">
                {actionError}
              </p>
            )}
          </section>
          <div className="visitor-aside">
            <section className="current-public">
              <div className="eyebrow">СЕЙЧАС ПРИНИМАЮТ</div>
              <div className="current-number">
                {data.current?.number || "—"}
              </div>
              <p>
                {data.current
                  ? "Этот номер уже вызван"
                  : "Ожидайте вызова вашего номера"}
              </p>
              <div className="public-divider" />
              <div className="public-stats">
                <div>
                  <strong>{data.stats.waiting}</strong>
                  <span>ожидают</span>
                </div>
                <div>
                  <strong>
                    {durationLabel(data.analytics?.averageSeconds)}
                  </strong>
                  <span>{data.analytics?.sampleCount ? "средний приём" : "после первого приёма"}</span>
                </div>
              </div>
              <p className="small muted">
                {data.analytics?.sampleCount
                  ? `Завершённых приёмов: ${data.analytics.sampleCount}. Оценка обновляется после каждого студента.`
                  : "Оценка появится, когда преподаватель завершит первый приём."}
              </p>
            </section>
            <section className="panel how-it-works">
              <h3>Одногруппник опоздал?</h3>
              <ol>
                <li>
                  <span>01</span>
                  <div>
                    <strong>Откройте свой талон</strong>
                    <p>Место остаётся за вами.</p>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <strong>Нажмите «Показать QR»</strong>
                    <p>На экране появится текущий код.</p>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <strong>Дайте отсканировать</strong>
                    <p>Одногруппник получит свой талон.</p>
                  </div>
                </li>
              </ol>
            </section>
          </div>
        </div>
      )}
      {share && data && (
        <Dialog title="QR для одногруппника" onClose={() => setShare(false)}>
          <p className="centered small muted">
            {data.settings.title} · {data.settings.teacherName}
          </p>
          <LiveQR
            queueId={queueId}
            generation={data.settings.generation}
            enabled={data.canShare && !error}
          />
          <p className="small muted centered">
            Ваш талон {mine?.number} и место в очереди не изменятся.
          </p>
        </Dialog>
      )}
      {confirm && (
        <Dialog title="Выйти из очереди?" onClose={() => setConfirm(false)}>
          <p>
            При повторной записи нужен свежий QR, а место будет в конце очереди.
          </p>
          <div className="dialog-actions">
            <Button tone="secondary" onClick={() => setConfirm(false)}>
              Остаться
            </Button>
            <Button tone="danger" disabled={busy} onClick={() => act("/leave")}>
              Выйти
            </Button>
          </div>
          <ErrorBox error={actionError} />
        </Dialog>
      )}
    </Shell>
  );
}
function Login({ onLogin }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <a href="#/" className="brand-link">
        <Brand />
      </a>
      <div className="panel login-panel">
        <span className="login-symbol">
          <ShieldCheck size={30} />
        </span>
        <div className="eyebrow">ПРЕПОДАВАТЕЛЬ</div>
        <h1>
          Ваша пара.
          <br />
          Ваша очередь.
        </h1>
        <p>Войдите с аккаунтом, который выдал владелец системы.</p>
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
function Metric({ icon: Icon, label, value, unit, detail, color }) {
  return (
    <section className="panel metric">
      <div className="metric-title">
        <span>{label}</span>
        <span className={`metric-icon ${color}`}>
          <Icon size={19} />
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
  const queues = useResource("/admin/queues", {
    admin: true,
    enabled: !!user,
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
    [resetGeneration, setResetGeneration] = useState(null),
    [baseUrl, setBaseUrl] = useState(savedBase),
    [displayUrl, setDisplayUrl] = useState("");
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
    enabled: !!qid,
  });
  const { data, error, refresh } = current,
    connectionError = me.error || queues.error || error;
  useEffect(() => {
    if (connectionError?.status === 401) onLogout();
  }, [connectionError?.status, onLogout]);
  useEffect(() => {
    if (
      !user ||
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
  }, [!!user]);
  useEffect(() => {
    setDisplayUrl("");
    if (!qid || !data) return;
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
  }, [qid, data?.settings.generation]);
  async function act(suffix, body, message, method = "POST", target = qid) {
    if (!target) return false;
    setBusy(true);
    setActionError("");
    try {
      await request(`/admin/queues/${target}${suffix}`, {
        admin: true,
        method,
        body,
      });
      await Promise.all([refresh(), queues.refresh()]);
      if (message) notify(message);
      return true;
    } catch (e) {
      setActionError(e.message);
      await refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await request("/admin/logout", { method: "POST", admin: true });
      onLogout();
    } catch (e) {
      setActionError(e.message);
    }
  }
  const disabled = busy || !!connectionError;
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
      data={data || me.data}
      error={connectionError}
      displayUrl={displayUrl}
    >
      <ErrorBox error={connectionError}>
        {" "}
        Действия недоступны до восстановления связи.
      </ErrorBox>
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
                ? "QR для вашей пары"
                : tab === "settings"
                  ? "Настройки пары"
                  : "Очереди на сдачу"}
          </h1>
          <p>
            {tab === "teachers"
              ? "Добавляйте коллег и управляйте их доступом."
              : user?.role === "owner"
                ? "Ваши очереди и очереди подключённых преподавателей."
                : "Каждая очередь работает независимо от остальных."}
          </p>
        </div>
        {tab !== "teachers" && (
          <Button onClick={() => setCreate(true)} disabled={!user || disabled}>
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
          {queues.data?.queues.length > 0 && (
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
                      {q.title} · {q.teacherName} · {q.room}
                    </option>
                  ))}
                </select>
              </label>
              {data && (
                <Status
                  status={data.settings.status}
                  disabled={!data.settings.teacherActive}
                />
              )}
            </div>
          )}
          {!qid ? (
            <section className="panel">
              <Empty
                title={
                  queues.data ? "Создайте первую очередь" : "Подключаемся…"
                }
              >
                Укажите название занятия и аудиторию. Сразу после создания
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
              notify={notify}
            />
          ) : (
            <>
              <div className="metrics">
                <Metric
                  icon={Users}
                  label="В очереди"
                  value={data.stats.waiting}
                  detail="ждут своего вызова"
                  color="purple"
                />
                <Metric
                  icon={CheckCheck}
                  label="Уже сдали"
                  value={data.stats.completed}
                  detail="за текущую пару"
                  color="green"
                />
                <Metric
                  icon={Clock3}
                  label="Ожидание в конце очереди"
                  value={
                    estimateMinutes(data.stats.waiting + (data.current ? 1 : 0), data.analytics) ?? "—"
                  }
                  unit={estimateMinutes(data.stats.waiting + (data.current ? 1 : 0), data.analytics) == null ? "" : "мин"}
                  detail={data.analytics?.sampleCount ? "по фактическому времени приёма" : "оценка после первого приёма"}
                  color="orange"
                />
              </div>
              <p className="small muted">
                {data.analytics?.sampleCount
                  ? `Средний приём: ${durationLabel(data.analytics.averageSeconds)} · Завершённых приёмов: ${data.analytics.sampleCount}.`
                  : "Пока нет завершённых приёмов — среднее время ещё неизвестно."}
                {" "}Время считается от вызова до «Завершить приём». Пропуски и отмены не учитываются.
              </p>
              <div className="admin-grid">
                <div>
                  <section className="admin-current">
                    <div className="current-top">
                      <span className="eyebrow">СЕЙЧАС НА ПРИЁМЕ</span>
                      <span className="current-tag">
                        {data.current ? "Идёт сдача" : "Можно вызвать"}
                      </span>
                    </div>
                    <div className="current-person">
                      <span className="admin-number">
                        {data.current?.number || "—"}
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
                                `/tickets/${data.current.id}/finish`,
                                { status: "done" },
                                "Сдача завершена.",
                              )
                            }
                          >
                            <Check size={18} />
                            Завершить приём
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
                          Активные{" "}
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
                          История пары
                        </button>
                      </div>
                      <span className="small muted">По порядку записи</span>
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
                      generation={data.settings.generation}
                      admin
                      baseUrl={baseUrl}
                      enabled={
                        data.settings.status === "open" &&
                        data.settings.teacherActive &&
                        !error
                      }
                    />
                    <Button
                      tone="secondary"
                      className="wide"
                      onClick={() => setTab("qr")}
                    >
                      Увеличить QR
                    </Button>
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
                  <div className="order-note">
                    <ShieldCheck size={20} />
                    <div>
                      <strong>QR меняется каждые 20 секунд</strong>
                      <p>
                        Выданные талоны продолжают работать независимо от смены
                        кода.
                      </p>
                    </div>
                  </div>
                </aside>
              </div>
            </>
          )}
        </>
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
                    room: values.get("room"),
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
            <label>
              Аудитория
              <input
                name="room"
                required
                maxLength={60}
                placeholder="Аудитория 302"
              />
            </label>
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
            Место сдачи
            <input
              name="room"
              defaultValue={data.settings.room}
              required
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
          <GraduationCap size={22} />
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
function QRSettings({ data, baseUrl, setBaseUrl, displayUrl, notify }) {
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
          generation={data.settings.generation}
          admin
          baseUrl={baseUrl}
          enabled={
            data.settings.status === "open" && data.settings.teacherActive
          }
        />
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
          Приглашение добавляется в QR автоматически. Секретная ссылка меняется
          каждые 20 секунд.
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
        <div className="qr-instructions">
          <Wifi size={21} />
          <div>
            <h3>Для локальной проверки</h3>
            <p>
              Телефон и компьютер должны быть в одной доступной сети. localhost
              на телефоне ведёт на сам телефон.
            </p>
          </div>
        </div>
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
      <ErrorBox error={resource.error || error} />
      <section className="panel">
        {resource.data?.teachers.length ? (
          <div className="teacher-list">
            {resource.data.teachers.map((t) => (
              <article className="teacher-row" key={t.id}>
                <span className="square-icon">
                  <GraduationCap size={23} />
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
                    Новый пароль
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
            Пароль
            <input readOnly value={credentials.password} />
          </label>
          <p className="small muted">
            Сохраните и передайте данные преподавателю. После закрытия пароль
            повторно не показывается; при необходимости можно создать новый.
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
              : "Создать новый пароль?"
          }
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm.teacher.name}:{" "}
            {confirm.action === "disable"
              ? "вход и новые записи в его очереди будут остановлены. Существующие талоны сохранятся."
              : "старые сессии входа завершатся. Очереди и талоны сохранятся."}
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
  const { data, error } = useResource(`/queues/${queueId}`);
  const [baseUrl] = useState(savedBase);
  return (
    <div className="screen-page">
      <header>
        <a href="#/" className="brand-link">
          <Brand />
        </a>
        <span>
          {data?.settings.title} / {data?.settings.teacherName} /{" "}
          {data?.settings.room}
        </span>
        {data && (
          <Status
            status={data.settings.status}
            disabled={!data.settings.teacherActive}
          />
        )}
      </header>
      <ErrorBox error={error}> На экране последние полученные данные.</ErrorBox>
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
              generation={data.settings.generation}
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
      <footer className="launch-footer">по порядку · онлайн-очередь на сдачу работ</footer>
    </div>
  );
}
createRoot(document.getElementById("root")).render(
  import.meta.env.VITE_DEPLOY_PENDING === "true" ? <LaunchPage /> : <App />,
);
