import React, { useEffect, useRef, useState, useCallback } from "react";
import { ListOrdered, LoaderCircle, Users, WifiOff, X } from "lucide-react";
import { request, cloudEnabled } from "./api";
import { applyLiveSnapshot } from "./live-state.mjs";

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
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <ListOrdered size={23} />
      </span>
      <span>
        по порядку<span className="brand-caption">очередь на пару</span>
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
export function Empty({ title, children, icon: Icon = Users }) {
  return (
    <div className="empty">
      <span>
        <Icon size={26} />
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
export function Dialog({ title, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Закрыть" onClick={onClose}>
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function useResource(
  path,
  { admin = false, enabled = true, poll = 3000 } = {},
) {
  const [state, setState] = useState({ key: null, data: null, error: null });
  const controller = useRef(null),
    keyRef = useRef(path);
  const latestLive = useRef(null);
  keyRef.current = path;
  const refresh = useCallback(async () => {
    if (!path || !enabled) return null;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const timeout = setTimeout(
      () => current.abort(new Error("Сервер не ответил. Попробуйте ещё раз.")),
      10000,
    );
    try {
      const data = await request(path, { admin, signal: current.signal });
      if (!current.signal.aborted && keyRef.current === path)
        setState((old) => {
          if (old.key === path && old.data?.revision > data.revision) return old;
          return { key: path, data: !admin && latestLive.current?.key === path
            ? applyLiveSnapshot(data, latestLive.current.snapshot) : data, error: null };
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
        }));
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }, [path, admin, enabled]);
  useEffect(() => {
    if (!enabled || !path) return;
    let active = true,
      timer, unsubscribe, eventTimer, connected = false;
    const queueId = path.match(/^\/(?:admin\/)?queues\/([^/]+)$/)?.[1];
    const tick = async () => {
      if (!cloudEnabled || document.visibilityState === "visible") await refresh();
      const interval = cloudEnabled ? (queueId && !connected ? 15000 : 180000) : poll;
      if (active && poll) timer = setTimeout(tick, interval);
    };
    tick();
    if (cloudEnabled && queueId) import("./realtime").then(({ subscribeQueue }) => {
      if (!active) return;
      unsubscribe = subscribeQueue(queueId, (snapshot) => {
        if (!active || document.visibilityState !== "visible") return;
        if (admin) {
          clearTimeout(eventTimer);
          eventTimer = setTimeout(refresh, 150);
        } else {
          latestLive.current = { key: path, snapshot };
          setState(s => s.key === path ? { ...s, data: applyLiveSnapshot(s.data, snapshot), error: null } : s);
        }
      }, (status) => {
        if (!active) return;
        connected = status === "SUBSCRIBED";
        // Refresh after subscribing/reconnecting to fill any missed-event gap.
        clearTimeout(timer);
        if (connected) tick();
        else if (poll) timer = setTimeout(tick, 15000);
      });
    }).catch(() => { connected = false; });
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const onStorage = (e) => {
      if (e.key === "campus.changed.v1" && document.visibilityState === "visible") refresh();
    };
    if (cloudEnabled) window.addEventListener("storage", onStorage);
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(eventTimer);
      unsubscribe?.();
      controller.current?.abort();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh, poll, path, enabled]);
  return {
    ...(state.key === path ? state : { data: null, error: null }),
    refresh,
  };
}
export function QR({ url, large = false }) {
  const [image, setImage] = useState("");
  useEffect(() => {
    let alive = true;
    setImage("");
    import("qrcode")
      .then((m) =>
        m.default.toDataURL(url, {
          width: 720,
          margin: 4,
          errorCorrectionLevel: "M",
          color: { dark: "#22243a", light: "#ffffff" },
        }),
      )
      .then((src) => {
        if (alive) setImage(src);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);
  return (
    <div className={`qr ${large ? "large" : ""}`}>
      {image ? (
        <img src={image} alt="Свежий QR-код для записи в очередь" />
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
}) {
  const [value, setValue] = useState(null),
    [error, setError] = useState(null),
    [tick, setTick] = useState(performance.now());
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
    ? `${baseUrl.split("#")[0]}#/q/${encodeURIComponent(queueId)}?invite=${encodeURIComponent(value.invite)}`
    : "";
  return (
    <div className="live-qr">
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
        <span>10 секунд</span>
      </div>
      <div className="qr-progress">
        <i style={{ width: `${remaining * 10}%` }} />
      </div>
      {error && <p className="field-error">{error.message}</p>}
      <p className="small muted">
        Сканируйте камерой сейчас. Старая фотография не подойдёт.
      </p>
    </div>
  );
}
