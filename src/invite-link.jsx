import React, { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2, LoaderCircle } from "lucide-react";
import { request, cloudEnabled } from "./api";
import { Button, Dialog, ErrorBox } from "./ui";
import { MinuteIntervalField } from "./minute-interval-field";
import { queueInviteUrl } from "./queue-links.mjs";

export function InviteLinkDialog({ queue, baseUrl, blocked, onClose }) {
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState("");
  const [now, setNow] = useState(() => performance.now());
  const controller = useRef(null), input = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!created) return;
    const update = () => {
      const time = performance.now();
      setNow(time);
      if (time >= created.deadline) clearInterval(timer);
    };
    const timer = setInterval(update, 1000);
    update();
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [created]);
  const remaining = created ? Math.max(0, Math.ceil((created.deadline - now) / 1000)) : 0;
  const countdown = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;

  async function generate(event) {
    event.preventDefault();
    if (busy || blocked) return;
    const intervalSeconds = Number(new FormData(event.currentTarget).get("linkMinutes")) * 60;
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const start = performance.now();
    const timeout = setTimeout(() => active.abort(new Error("Сервер не ответил. Попробуйте ещё раз.")), 10000);
    setBusy(true); setError(""); setCopyState("");
    try {
      const result = await request(`/admin/queues/${queue.id}/invite-link`, {
        admin: true, method: "POST", signal: active.signal,
        body: { intervalSeconds, generation: queue.generation },
      });
      if (active.signal.aborted) return;
      const deadline = start + result.expiresAt - result.serverNow;
      setCreated({
        url: queueInviteUrl(location.href, baseUrl, cloudEnabled, queue.id, result.invite),
        deadline,
      });
      setNow(performance.now());
    } catch (e) {
      if (!active.signal.aborted || active.signal.reason?.message === "Сервер не ответил. Попробуйте ещё раз.")
        setError(active.signal.aborted ? active.signal.reason.message : e.message);
    } finally {
      clearTimeout(timeout);
      if (controller.current === active) setBusy(false);
    }
  }

  async function copy() {
    if (!created || performance.now() >= created.deadline || blocked || busy) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopyState("copied");
    } catch {
      input.current?.focus(); input.current?.select();
      setCopyState("manual");
    }
  }

  return (
    <Dialog title="Ссылка для записи" onClose={onClose}>
      <p className="muted">{queue.title}. QR и ссылка работают одновременно и ведут в одну очередь. Отправьте ссылку тем, кому удобнее открыть её без камеры.</p>
      <form onSubmit={generate}>
        <MinuteIntervalField initialSeconds={queue.qrIntervalSeconds} name="linkMinutes"
          label="Срок новой ссылки, мин" disabled={busy || blocked}
          hint="От 1 до 10 минут с момента создания. Интервал QR останется прежним." />
        <Button className="wide" disabled={busy || blocked}>
          {busy ? <LoaderCircle size={18} className="spin" /> : <Link2 size={18} />}
          {busy ? "Создаём…" : created ? "Создать новую ссылку" : "Создать ссылку"}
        </Button>
      </form>
      <ErrorBox error={error} />
      {blocked && <p className="field-error" role="status">Выдача ссылок недоступна. Проверьте связь и откройте запись в очередь.</p>}
      {created && <section className={`invite-link-result ${remaining === 0 ? "expired" : ""}`}>
        <p className="invite-link-status" role="status">
          {remaining > 0 ? "Ссылка готова" : "Срок ссылки истёк"}
          {remaining > 0 && <strong aria-live="off">{countdown}</strong>}
        </p>
        <label>Ссылка для студентов
          <input ref={input} value={created.url} readOnly onFocus={e => e.currentTarget.select()} />
        </label>
        <Button type="button" tone="secondary" className="wide" disabled={busy || blocked || remaining === 0} onClick={copy}>
          {copyState === "copied" && remaining > 0 ? <Check size={18} /> : <Copy size={18} />}
          {copyState === "copied" && remaining > 0 ? "Скопировано" : "Скопировать ссылку"}
        </Button>
        {copyState === "manual" && <p className="small" role="status">Автокопирование недоступно. Ссылка выделена — скопируйте её вручную.</p>}
        <p className="small muted">{remaining > 0
          ? "Студентам нужно открыть её до конца отсчёта. После открытия будет 2 минуты на ввод имени."
          : "Создайте новую ссылку для записи. Талоны уже записавшихся студентов сохранятся."}</p>
      </section>}
    </Dialog>
  );
}
