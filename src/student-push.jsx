import React, { useEffect, useRef, useState } from "react";
import { Bell, BellRing, Copy, Share, PlusSquare } from "lucide-react";
import { cloudEnabled, request, restoreVisitor, visitorStorageAvailable } from "./api";
import { Button, Dialog } from "./ui";
import { studentMedia } from "./student-ui";
import { appDirectory, applicationServerKey, normalizedTransferCode, pushDevice } from "./push-device.mjs";
import "./student-push.css";

function device() {
  return pushDevice({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints,
    standalone: navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches });
}
const supported = () => window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
let preparation;
async function prepare() {
  if (!preparation) preparation = (async () => {
    const root = appDirectory(location.href);
    const [registration, config] = await Promise.all([
      navigator.serviceWorker.register(new URL("sw.js", root), { scope: root.pathname, updateViaCache: "none" }),
      request("/push/config"),
    ]);
    if (!config.enabled) throw new Error("Уведомления пока настраиваются. Попробуйте немного позже.");
    if (!registration.active) await new Promise((resolve, reject) => {
      const worker = registration.installing || registration.waiting;
      const timeout = setTimeout(() => { worker?.removeEventListener("statechange", changed); reject(new Error("Не удалось подготовить уведомления. Повторите попытку.")); }, 12000);
      function changed() {
        if (registration.active) { clearTimeout(timeout); worker?.removeEventListener("statechange", changed); resolve(); }
        else if (worker?.state === "redundant") { clearTimeout(timeout); worker.removeEventListener("statechange", changed); reject(new Error("Обновите страницу и повторите попытку.")); }
      }
      worker?.addEventListener("statechange", changed); changed();
    });
    return { registration, config };
  })().catch(error => { preparation = null; throw error; });
  return preparation;
}

export function StudentPush() {
  const [platform] = useState(device);
  const [modal, setModal] = useState(false);
  const [state, setState] = useState({ enabled: false, busy: false, error: "" });
  const interacted = useRef(false);
  useEffect(() => {
    if (!cloudEnabled || platform.needsInstall || !supported()) return;
    let live = true;
    const sync = async () => {
      try {
        const { registration } = await prepare();
        const subscription = await registration.pushManager.getSubscription();
        const status = subscription && Notification.permission === "granted"
          ? await request("/push/status", { method: "POST", body: { endpoint: subscription.endpoint } }) : { enabled: false };
        if (live && !interacted.current) setState(s => ({ ...s, enabled: status.enabled }));
      } catch { /* the button retries and reports an actionable error */ }
    };
    void sync();
    return () => { live = false; };
  }, [platform]);
  if (!cloudEnabled) return null;

  async function toggle() {
    interacted.current = true;
    if (platform.needsInstall) { setModal(true); return; }
    if (!supported()) { setState(s => ({ ...s, error: "В этом браузере уведомления недоступны. Попробуйте актуальный Chrome или Safari; на iPhone нужна iOS 16.4 или новее." })); return; }
    if (!state.enabled && Notification.permission === "denied") {
      setState(s => ({ ...s, error: "Уведомления заблокированы. Разрешите их для РИТМ в настройках браузера или телефона, затем нажмите ещё раз." })); return;
    }
    // Ask synchronously in the click handler. An awaited HTTP request before
    // requestPermission would lose the user activation required by iOS.
    setState(s => ({ ...s, busy: true, error: "" }));
    try {
      const permission = !state.enabled && Notification.permission === "default" ? Notification.requestPermission() : Promise.resolve(Notification.permission);
      if (!state.enabled && await permission !== "granted") throw new Error("Разрешение не выдано. Вы сможете включить уведомления позже.");
      const { registration, config } = await prepare();
      let subscription = await registration.pushManager.getSubscription();
      if (state.enabled) {
        if (subscription) {
          await request("/push/unsubscribe", { method: "POST", body: { endpoint: subscription.endpoint } });
          await subscription.unsubscribe();
        }
        setState({ enabled: false, busy: false, error: "" });
      } else {
        subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.publicKey) });
        await request("/push/subscribe", { method: "POST", body: { subscription: subscription.toJSON() } });
        setState({ enabled: true, busy: false, error: "" });
      }
    } catch (error) {
      setState(s => ({ ...s, busy: false, error: error.name === "NotAllowedError" ? "Разрешите уведомления в настройках браузера или телефона." : error.message || "Не удалось включить уведомления. Повторите попытку." }));
    }
  }
  return <section className="student-push" aria-label="Уведомления о вызове">
    <button type="button" disabled={state.busy} aria-pressed={state.enabled} onClick={toggle}>
      {state.enabled ? <BellRing size={19} /> : <Bell size={19} />}
      {state.busy ? "Подключаем…" : state.enabled ? "Уведомления включены" : "Уведомить о вызове"}
    </button>
    <p>{state.enabled ? "Пришлём уведомление на этот телефон, даже если страница закрыта." : "Ваш вызов — прямо на экран телефона."}</p>
    {state.enabled && <small>Нажмите ещё раз, чтобы отключить.</small>}
    {state.error && <p className="field-error" role="alert">{state.error}</p>}
    {modal && <IosPushGuide onClose={() => setModal(false)} />}
  </section>;
}

export function IosPushGuide({ onClose }) {
  const [transfer, setTransfer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  async function backup() {
    setBusy(true); setError("");
    try { setTransfer(await request("/push/transfer-create", { method: "POST", body: {} })); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <Dialog title="Ваш вызов на iPhone" onClose={onClose}>
    <div className="push-guide">
      <img className="push-mascot" src={studentMedia("ritm-done.webp")} width="128" height="128" alt="Котик РИТМ подсказывает" />
      <p className="push-guide-intro">Добавьте РИТМ на главный экран.<br />Тогда мы сможем позвать вас, даже когда приложение закрыто.</p>
      <ol>
        <li><span><Share size={21} /></span><div><strong>Откройте «Поделиться»</strong><p>В Safari нажмите кнопку со стрелкой вверх. В другом браузере она может быть в меню «…».</p></div></li>
        <li><span><PlusSquare size={21} /></span><div><strong>Выберите «На экран Домой»</strong><p>Если есть «Открывать как веб-приложение», оставьте включённым. Затем нажмите «Добавить».</p></div></li>
        <li><span><Bell size={21} /></span><div><strong>Откройте РИТМ с новой иконки</strong><p>Откройте свой талон → «Уведомить о вызове» → «Разрешить».</p></div></li>
      </ol>
      <div className="push-transfer-backup">
        <strong>Чтобы талон точно остался с вами</strong>
        <p>Сохраните код перед установкой. Если в приложении нет талона, нажмите «Перенести мой талон» на главном экране.</p>
        {!transfer ? <Button tone="secondary" className="wide" onClick={backup} disabled={busy}>{busy ? "Готовим код…" : "Получить код переноса"}</Button>
          : <><code>{transfer.code.match(/.{1,4}/g).join(" ")}</code>
            <button className="push-copy" type="button" onClick={async () => { try { await navigator.clipboard.writeText(transfer.code); setCopied(true); } catch { setError("Скопируйте код вручную или сохраните скриншот."); } }}><Copy size={16} />{copied ? "Скопировано" : "Скопировать код"}</button>
            <small>Действует 20 минут. Не передавайте его другим: это доступ к вашим талонам.</small></>}
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
      <small>Нужна iOS 16.4 или новее. В обычной вкладке iPhone push-уведомления не работают.</small>
      <Button className="wide" onClick={onClose}>Понятно :3</Button>
    </div>
  </Dialog>;
}

export function RestoreTicket() {
  const [platform] = useState(device);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!cloudEnabled || !platform.ios || !platform.standalone) return null;
  return <div className="restore-ticket">
    <button type="button" onClick={() => setOpen(true)}>Перенести мой талон</button>
    {open && <Dialog title="Талон из браузера" onClose={() => setOpen(false)}>
      <form className="push-guide" onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError("");
        try {
          if (!visitorStorageAvailable()) throw new Error("Разрешите хранение данных сайта.");
          const result = await request("/push/transfer-claim", { method: "POST", body: { code: normalizedTransferCode(code) } });
          restoreVisitor(result.token);
          location.hash = "#/"; location.reload();
        } catch (e) { setError(e.message); setBusy(false); }
      }}>
        <p>В браузере с вашим талоном откройте «Уведомить о вызове» → «Получить код переноса». Введите его здесь. Место в очереди сохранится.</p>
        <label>Код переноса<input value={code} onChange={e => setCode(e.target.value)} placeholder="XXXX XXXX XXXX XXXX" autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false} maxLength={24} required /></label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <Button className="wide" disabled={busy || !/^[A-F0-9]{16}$/.test(normalizedTransferCode(code))}>{busy ? "Переносим…" : "Вернуть мой талон"}</Button>
      </form>
    </Dialog>}
  </div>;
}
