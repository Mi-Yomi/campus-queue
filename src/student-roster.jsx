import React from "react";
import { studentMedia } from "./student-ui";

function RosterRow({ ticket, own = false }) {
  return <li className={`student-roster-row ${own ? "student-roster-own" : ""} ${ticket.status === "called" ? "student-roster-called" : ""}`}>
    <span className="student-roster-number">{ticket.number}</span>
    <span className="student-roster-person">
      <strong>{ticket.name || "Обновляем имя…"}</strong>
      {ticket.status === "called" && <small>Сейчас на приёме</small>}
    </span>
    {own && <span className="student-roster-you">Вы</span>}
  </li>;
}

export function StudentRoster({ roster, mine, refreshing }) {
  if (!roster) return null;
  const ownIndex = roster.findIndex(t => t.seq === mine.seq);
  const before = ownIndex < 0 ? [] : roster.slice(0, ownIndex);
  const after = ownIndex < 0 ? [] : roster.slice(ownIndex + 1);
  const waiting = mine.status === "waiting";
  return <section className={`student-roster ${waiting ? "student-roster-sleeping" : ""}`} aria-labelledby="student-roster-heading" aria-busy={!!refreshing}>
    {waiting && <img className="student-roster-mascot" src={studentMedia("ritm-sleeping.webp")}
      alt="Котик РИТМ спит на очереди" width="200" height="112" draggable="false" />}
    <header><h2 id="student-roster-heading">Кто в очереди</h2><span>{roster.length} чел.</span></header>
    <h3>Перед вами <span>{before.length}</span></h3>
    {before.length ? <ol>{before.map(t => <RosterRow key={t.seq} ticket={t} />)}</ol>
      : <p className="student-roster-empty">{mine.status === "called" ? "Сейчас ваша очередь" : "Вы следующий :3"}</p>}
    <ol className="student-roster-self"><RosterRow ticket={mine} own /></ol>
    <h3>После вас <span>{after.length}</span></h3>
    {after.length ? <ol>{after.map(t => <RosterRow key={t.seq} ticket={t} />)}</ol>
      : <p className="student-roster-empty">Пока никого</p>}
  </section>;
}
