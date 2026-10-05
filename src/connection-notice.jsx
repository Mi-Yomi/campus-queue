import React from "react";

export function ConnectionNotice({ error, retry, refreshing, updatedAt, ticketSaved = false }) {
  if (!error) return null;
  const connection = error.isConnectionError || !error.status || error.status >= 500;
  return <section className="connection-notice" role="status" aria-live="polite">
    <img src={`${import.meta.env.BASE_URL}media/ritm-sad.webp`} alt="Расстроенный котик РИТМ" width="96" height="96" />
    <div className="connection-notice-copy">
      <h2>{connection ? "Связь потерялась :(" : "Не удалось обновить данные"}</h2>
      <p>{connection ? ticketSaved
        ? "Талон сохранён. При подключении проверим ваше место в очереди."
        : "Пробуем подключиться снова. Сохранённые данные останутся на месте."
        : error.message}</p>
      {updatedAt > 0 && <p className="connection-notice-time">Последнее обновление: {new Date(updatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>}
      <button className="button secondary" type="button" disabled={refreshing} onClick={retry}>
        {refreshing ? "Подключаемся…" : "Повторить"}
      </button>
    </div>
  </section>;
}
