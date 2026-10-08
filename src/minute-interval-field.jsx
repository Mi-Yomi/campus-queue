import React, { useState } from "react";
import { Button } from "./ui";

export function MinuteIntervalField({ initialSeconds = 60, disabled = false,
  name = "qrIntervalMinutes", label = "Обновлять QR каждые, мин",
  hint = "От 1 до 10 минут. Смена интервала сохраняет все талоны." }) {
  const [minutes, setMinutes] = useState(() => initialSeconds / 60);
  return (
    <div className="qr-interval-field">
      <label>
        {label}
        <input name={name} type="number" min="1" max="10" step="1" required
          value={minutes} onChange={e => setMinutes(e.target.value)} disabled={disabled} />
      </label>
      <div className="qr-interval-presets" aria-label="Быстрый выбор времени">
        {[1, 2].map(value => <Button key={value} type="button" tone="secondary"
          aria-pressed={Number(minutes) === value} disabled={disabled}
          onClick={() => setMinutes(value)}>{value} мин</Button>)}
      </div>
      <p className="small muted">{hint}</p>
    </div>
  );
}
