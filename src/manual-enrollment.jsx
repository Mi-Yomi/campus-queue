import React, { useState } from "react";
import { request, storage } from "./api";
import { Button, Dialog, ErrorBox, statusNames } from "./ui";

export function ManualEnrollment({ queue, blocked, onClose, onAdded }) {
  const key = `campus.manual-entry.v1.${queue.id}`;
  const [attempt, setAttempt] = useState(() => {
    try {
      const saved = JSON.parse(storage.get(key, true));
      return saved?.generation === queue.generation && typeof saved.name === "string" && typeof saved.requestId === "string" ? saved : null;
    } catch { return null; }
  });
  const [name, setName] = useState(attempt?.name || "");
  const [busy, setBusy] = useState(false), [ticket, setTicket] = useState(null);
  const [error, setError] = useState(attempt ? "Проверим предыдущую попытку записи. Повтор не создаст второй талон." : "");
  async function submit(event) {
    event.preventDefault();
    if (busy || blocked) return;
    const body = attempt || { name: name.trim(), generation: queue.generation, requestId: crypto.randomUUID() };
    if (!body.name) { setError("Введите имя и фамилию."); return; }
    if (!storage.set(key, JSON.stringify(body), true)) {
      setError("Не удалось сохранить попытку записи в браузере. Разрешите хранение данных сайта."); return;
    }
    setAttempt(body); setBusy(true); setError("");
    try {
      const result = await request(`/admin/queues/${queue.id}/tickets`, { admin: true, method: "POST", body });
      setTicket(result.ticket); setAttempt(null); storage.set(key, null, true);
      await onAdded(result.ticket);
    } catch (err) {
      const uncertain = !err.status || err.status >= 500;
      setError(uncertain ? "Не получили ответ. Повторите попытку — второй талон не появится." : err.message);
      if (!uncertain) { setAttempt(null); storage.set(key, null, true); }
    } finally { setBusy(false); }
  }
  return <Dialog title={ticket ? "Талон готов" : "Добавить студента"} onClose={onClose} dismissible={!busy}>
    {ticket ? <div className="manual-ticket-result">
      <strong className="manual-ticket-number">{ticket.number}</strong>
      <h3>{ticket.name}</h3><p>{statusNames[ticket.status]}</p>
      <p>Назовите студенту его номер. Когда подойдёт очередь, пригласите его голосом.</p>
      <Button className="wide" onClick={onClose}>Готово</Button>
    </div> : <form onSubmit={submit}>
      <p className="manual-entry-caption">{queue.title}</p>
      <p className="manual-entry-hint">Если у студента нет телефона или не читается QR, запишите его здесь. Он попадёт в конец очереди.</p>
      <label>Имя и фамилия<input name="studentName" required maxLength={60} autoComplete="off" autoFocus
        placeholder="Например, Лукпанов Ануар" value={name} readOnly={!!attempt}
        onChange={event => setName(event.target.value)} /></label>
      <ErrorBox error={error} />
      {blocked && <p className="field-error">Дождитесь восстановления связи с очередью.</p>}
      <Button className="wide" disabled={busy || blocked}>{busy ? "Записываем…" : attempt ? "Повторить запись" : "Добавить в очередь"}</Button>
    </form>}
  </Dialog>;
}
