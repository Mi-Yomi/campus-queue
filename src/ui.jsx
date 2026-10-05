import React, { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, Maximize, WifiOff, X } from "lucide-react";
import { request, cloudEnabled } from "./api";
import { applyLiveSnapshot } from "./live-state.mjs";
import { queueBase } from "./queue-links.mjs";
import { roundedQrSvg } from "./qr-art.mjs";
import qrLogo from "./assets/ritm-qr-mark.png?inline";
import { createResourcePoller } from "./resource-poller.mjs";

export const time = (value) =>
  new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
export const statusNames = {
  waiting: "В очереди",
  called: "На приёме",
  done: "Сдано",
  skipped: "Пропущен",
  cancelled: "Отменён",
};
export const activeTicket = (ticket) =>
  ticket &&
  ["waiting", "called"].includes(ticket.status) &&
  !ticket.previousSession;
export const here = () => `${location.origin}${location.pathname}`;
export function Brand({ compact = false }) {
  return (
    <div className={`brand ritm-brand ${compact ? "brand-compact" : ""}`}>
      <span className="brand-mark">
        <img src={`${import.meta.env.BASE_URL}brand/ritm-mark.webp`} width="48" height="48" alt="" />
      </span>
      <span>
        <span className="brand-wordmark">РИТМ</span>{!compact && <span className="brand-caption">очередь на пару</span>}
      </span>
    </div>
  );
}
export function Button({
  children,
  tone = "primary",
  className = "",
  ...props
}) {
  return (
    <button className={`button ${tone} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function Status({ status, disabled }) {
  return (
    <span className={`status ${disabled ? "closed" : status}`}>
      <i />
      {disabled
        ? "Преподаватель отключён"
        : status === "open"
          ? "Запись открыта"
          : status === "paused"
            ? "Запись на паузе"
            : "Запись закрыта"}
    </span>
  );
}
export function Empty({ title, children, icon: Icon }) {
  return (
    <div className="empty">
      <span>
        {Icon ? <Icon size={26} /> : <img src={`${import.meta.env.BASE_URL}media/sleeping.png`} width="64" height="64" alt="" />}
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function ErrorBox({ error, children }) {
  return error ? (
    <div className="connection-error" role="alert">
      <WifiOff size={18} />
      <span>
        {typeof error === "string" ? error : error.message}
        {children}
      </span>
    </div>
  ) : null;
}
export function Dialog({ title, children, onClose, dismissible = true }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(event) => { event.preventDefault(); if (dismissible) onClose(); }}
      onClick={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        {dismissible && <button className="icon-button" aria-label="Закрыть" onClick={onClose}>
          <X />
        </button>}
      </div>
      {children}
    </dialog>
  );
}
export function useResource(
  path,
  { admin = false, enabled = true, poll = 3000 } = {},
) {
  const [state, setState] = useState({ key: null, data: null, error: null, updatedAt: 0, refreshing: false });
  const controller = useRef(null),
    keyRef = useRef(path);
  const poller = useRef(null);
  const latestLive = useRef(null);
  keyRef.current = path;
  const load = useCallback(async () => {
    if (!path || !enabled) return null;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState(s => s.key === path ? { ...s, refreshing: true }
      : { key: path, data: null, error: null, updatedAt: 0, refreshing: true });
    const timeout = setTimeout(
      () => current.abort(new Error("Сервер не ответил. Попробуйте ещё раз.")),
      10000,
    );
    try {
      const data = await request(path, { admin, signal: current.signal });
      if (!current.signal.aborted && keyRef.current === path)
        setState((old) => {
          if (old.key === path && old.data?.revision > data.revision)
            return { ...old, error: null, refreshing: false, updatedAt: Date.now() };
          return { key: path, data: !admin && latestLive.current?.key === path
            ? applyLiveSnapshot(data, latestLive.current.snapshot) : data,
            error: null, refreshing: false, updatedAt: Date.now() };
        });
      return data;
    } catch (error) {
      if (
        keyRef.current === path &&
        (!current.signal.aborted ||
          (current.signal.reason instanceof Error &&
            current.signal.reason.name !== "AbortError"))
      )
        setState((s) => ({
          key: path,
          data: s.key === path ? s.data : null,
          error,
          updatedAt: s.key === path ? s.updatedAt : 0,
          refreshing: false,
        }));
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }, [path, admin, enabled]);
  const refresh = useCallback(() => poller.current?.refresh() ?? Promise.resolve(null), []);
  useEffect(() => {
    if (!enabled || !path) return;
    let active = true, unsubscribe, eventTimer, connected = false;
    const queueId = path.match(/^\/(?:admin\/)?queues\/([^/]+)$/)?.[1];
    const sync = createResourcePoller({
      load, online: () => navigator.onLine !== false,
      visible: () => document.visibilityState === "visible",
      interval: () => !poll ? 0 : cloudEnabled ? (queueId && !connected ? 15000 : 180000) : poll,
      onOffline: () => {
        controller.current?.abort();
        setState(s => ({ key: path, data: s.key === path ? s.data : null,
          updatedAt: s.key === path ? s.updatedAt : 0, refreshing: false,
          error: Object.assign(new Error("Нет подключения к интернету."), { isConnectionError: true }) }));
      },
    });
    poller.current = sync;
    void sync.refresh();
    if (cloudEnabled && queueId) import("./realtime").then(({ subscribeQueue }) => {
      if (!active) return;
      unsubscribe = subscribeQueue(queueId, (snapshot) => {
        if (!active || document.visibilityState !== "visible") return;
        if (admin) {
          clearTimeout(eventTimer);
          eventTimer = setTimeout(sync.refresh, 150);
        } else {
          latestLive.current = { key: path, snapshot };
          setState(s => s.key === path ? { ...s, data: applyLiveSnapshot(s.data, snapshot), updatedAt: Date.now() } : s);
        }
      }, (status) => {
        if (!active) return;
        connected = status === "SUBSCRIBED";
        // Refresh after subscribing/reconnecting to fill any missed-event gap.
        void sync.refresh();
      });
    }).catch(() => { connected = false; if (active) void sync.refresh(); });
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", sync.refresh);
    window.addEventListener("offline", sync.offline);
    const onStorage = (e) => {
      if (e.key === "campus.changed.v1" && document.visibilityState === "visible") void sync.refresh();
    };
    if (cloudEnabled) window.addEventListener("storage", onStorage);
    return () => {
      active = false;
      sync.stop();
      if (poller.current === sync) poller.current = null;
      clearTimeout(eventTimer);
      unsubscribe?.();
      controller.current?.abort();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", sync.refresh);
      window.removeEventListener("offline", sync.offline);
      window.removeEventListener("storage", onStorage);
    };
  }, [load, poll, path, enabled]);
  return {
    ...(state.key === path ? state : { data: null, error: null, updatedAt: 0, refreshing: false }),
    refresh,
  };
}
export function QR({ url, large = false }) {
  const [image, setImage] = useState(null), [availableWidth, setAvailableWidth] = useState(0);
  const frame = useRef(null);
  useEffect(() => {
    const element = frame.current;
    const resize = () => setAvailableWidth(element.clientWidth);
    resize();
    if (!window.ResizeObserver) {
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let alive = true;
    import("qrcode")
      .then((m) => {
        const matrix = m.default.create(url, { errorCorrectionLevel: "H" }).modules;
        const src = roundedQrSvg(matrix, qrLogo);
        if (alive) setImage({ url, modules: matrix.size + 8, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}` });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);
  return (
    <div ref={frame} className={`qr ${large ? "large" : ""}`}>
      {image?.url === url ? (
        <img src={image.src} style={{ width: availableWidth >= image.modules
          ? Math.floor(availableWidth / image.modules) * image.modules : "100%" }}
          alt="Свежий QR-код для записи в очередь" />
      ) : (
        <LoaderCircle className="spin" />
      )}
    </div>
  );
}
export function LiveQR({
  queueId,
  generation,
  baseUrl = here(),
  admin = false,
  displayToken,
  enabled = true,
  title = "Запись в очередь",
  subtitle = "РИТМ · очередь на пару",
  initiallyExpanded = false,
  onClose,
}) {
  const [value, setValue] = useState(null),
    [error, setError] = useState(null),
    [tick, setTick] = useState(performance.now()),
    [expanded, setExpanded] = useState(initiallyExpanded);
  const dialog = useRef(null), surface = useRef(null), nativeFullscreen = useRef(false);
  const closeQR = useCallback(() => {
    nativeFullscreen.current = false;
    if (document.fullscreenElement === surface.current) document.exitFullscreen?.().catch(() => {});
    dialog.current?.close();
    setExpanded(false);
    onClose?.();
  }, [onClose]);
  const openQR = () => {
    dialog.current?.showModal();
    setExpanded(true);
    // Unsupported mobile browsers keep the same full-viewport dialog.
    surface.current?.requestFullscreen?.().catch(() => {});
  };
  useEffect(() => {
    if (initiallyExpanded) dialog.current?.showModal();
  }, [initiallyExpanded]);
  useEffect(() => {
    const changed = () => {
      if (document.fullscreenElement === surface.current) nativeFullscreen.current = true;
      else if (nativeFullscreen.current) closeQR();
    };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, [closeQR]);
  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let wakeLock, disposed = false;
    const keepAwake = async () => {
      if (document.visibilityState !== "visible" || !navigator.wakeLock) return;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (disposed) await lock.release();
        else wakeLock = lock;
      } catch { /* QR remains usable when the browser cannot keep the screen awake. */ }
    };
    keepAwake();
    document.addEventListener("visibilitychange", keepAwake);
    return () => {
      disposed = true;
      wakeLock?.release().catch(() => {});
      document.removeEventListener("visibilitychange", keepAwake);
      document.body.style.overflow = previousOverflow;
    };
  }, [expanded]);
  useEffect(() => {
    if (!enabled) {
      setValue(null);
      return;
    }
    let active = true,
      timer,
      controller;
    const load = async () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      const requestController = controller;
      const start = performance.now(),
        timeout = setTimeout(() => requestController.abort(), 8000);
      try {
        const path = displayToken
          ? `/display/queues/${queueId}/invite`
          : admin
            ? `/admin/queues/${queueId}/invite`
            : `/queues/${queueId}/invite`;
        const result = await request(path, {
          admin,
          displayToken,
          signal: requestController.signal,
        });
        if (!active || requestController.signal.aborted) return;
        const remaining =
          result.expiresAt - result.serverNow - (performance.now() - start);
        setValue({ ...result, deadline: performance.now() + remaining });
        setTick(performance.now());
        setError(null);
        // Wait past server expiry; fetching early would return the same QR again.
        timer = setTimeout(load, Math.max(250, result.expiresAt - result.serverNow + 100));
      } catch (e) {
        if (active && !requestController.signal.aborted) {
          setError(e);
          setValue(null);
          timer = setTimeout(load, 1500);
        } else if (active && controller === requestController) {
          setError(new Error("QR временно недоступен. Восстанавливаем связь…"));
          setValue(null);
          timer = setTimeout(load, 1500);
        }
      } finally {
        clearTimeout(timeout);
      }
    };
    load();
    const visible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [queueId, generation, admin, displayToken, enabled]);
  useEffect(() => {
    const timer = setInterval(() => setTick(performance.now()), 100);
    return () => clearInterval(timer);
  }, []);
  const remaining = value
    ? Math.max(0, Math.ceil((value.deadline - tick) / 1000))
    : 0;
  const url = value
    ? `${queueBase(location.href, baseUrl, cloudEnabled)}#/q/${encodeURIComponent(queueId)}?invite=${encodeURIComponent(value.invite)}`
    : "";
  const code = (
    <div className={`live-qr ${expanded ? "live-qr-expanded" : ""}`}>
      <div className="live-qr-image">
        {enabled && remaining > 0 && !error ? (
          <QR url={url} large />
        ) : (
          <div className="qr large qr-unavailable">
            {!enabled ? (
              <span>Запись приостановлена</span>
            ) : error ? (
              <span>Восстанавливаем QR…</span>
            ) : (
              <LoaderCircle className="spin" />
            )}
          </div>
        )}
      </div>
      <div className="qr-countdown" aria-live="off">
        <span>
          {enabled && remaining > 0
            ? `Новый QR через ${remaining} с`
            : enabled
              ? "Обновляем код…"
              : "Новые записи недоступны"}
        </span>
        <span>{Math.round((value?.intervalMs || 20000) / 1000)} секунд</span>
      </div>
      <div className="qr-progress">
        <i style={{ width: `${Math.min(100, remaining * 100000 / (value?.intervalMs || 20000))}%` }} />
      </div>
      {error && <p className="field-error">{error.message}</p>}
      <p className="small muted">
        Наведите камеру на код. Ваше место в очереди сохранится.
      </p>
    </div>
  );
  return (
    <>
      {!expanded && !initiallyExpanded && (
        <>
          {code}
          <Button tone="secondary" className="wide qr-expand" onClick={openQR}>
            <Maximize size={18} /> На весь экран
          </Button>
        </>
      )}
      {createPortal(
        <dialog ref={dialog} className="qr-fullscreen" aria-label="QR-код на весь экран"
          onCancel={(event) => { event.preventDefault(); closeQR(); }}>
          <div className="qr-focus-surface" ref={surface}>
            <header className="qr-focus-header">
              <div><strong>{title}</strong><span>{subtitle}</span></div>
              <button className="qr-close" onClick={closeQR} aria-label="Закрыть QR">
                <X size={22} /><span>Закрыть</span>
              </button>
            </header>
            {expanded && code}
          </div>
        </dialog>, document.body,
      )}
    </>
  );
}
