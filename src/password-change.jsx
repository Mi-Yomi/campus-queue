import React, { useState } from "react";
import { LockKeyhole } from "lucide-react";
import { request } from "./api";
import { Button, Dialog, ErrorBox } from "./ui";

export function PasswordChange({ user, suggested, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const newPassword = form.get("newPassword");
    if (newPassword !== form.get("repeatPassword")) {
      setError("Новые пароли не совпадают. Проверьте повтор пароля.");
      return;
    }
    if (newPassword !== newPassword.trim()) {
      setError("Уберите пробелы в начале и конце нового пароля.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await request("/admin/password", {
        admin: true, method: "POST",
        body: { currentPassword: form.get("currentPassword"), newPassword },
      });
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }
  return (
    <Dialog title="Ваш пароль" onClose={() => { if (!busy) onClose(); }}>
      <div className="password-intro">
        <div className="password-mascot">
          <img src={`${import.meta.env.BASE_URL}brand/ritm-mark.webp`} alt="Маскот РИТМ" width="96" height="96" />
          <span><LockKeyhole size={18} /></span>
        </div>
        <h3>{suggested ? "Давайте придумаем свой" : "Новый пароль для входа"}</h3>
        <p>{suggested ? "Вам выдали пароль для первого входа. Замените его на тот, который знаете только вы." : "После смены на других устройствах нужно будет войти заново."}</p>
      </div>
      <form className="password-form" onSubmit={submit}>
        <input type="text" name="username" autoComplete="username" value={user.username} readOnly hidden />
        <label>Текущий пароль<input name="currentPassword" type={visible ? "text" : "password"} autoComplete="current-password" required maxLength={200} disabled={busy} /></label>
        <label>Новый пароль<input name="newPassword" type={visible ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={128} aria-describedby="password-hint" disabled={busy} /></label>
        <p id="password-hint" className="password-hint">От 8 до 128 символов</p>
        <label>Повторите новый пароль<input name="repeatPassword" type={visible ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={128} disabled={busy} /></label>
        <label className="password-visibility"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />Показать пароли</label>
        <ErrorBox error={error} />
        <Button type="submit" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить новый пароль"}</Button>
        <Button type="button" tone="ghost" disabled={busy} onClick={onClose}>{suggested ? "Позже" : "Отмена"}</Button>
      </form>
    </Dialog>
  );
}
