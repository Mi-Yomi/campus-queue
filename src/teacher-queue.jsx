import React, { useState } from "react";
import { createPortal } from "react-dom";
import { GripVertical } from "lucide-react";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { statusNames, time } from "./ui";
import { durationLabel, serviceSeconds } from "./queue-analytics.mjs";

function TicketCells({ ticket }) {
  return <>
    <td><span className="number-pill">{ticket.number}</span></td>
    <td><strong>{ticket.name}</strong>
      {ticket.attempt > 1 && <span className="retake-badge">Пересдача · попытка {ticket.attempt}</span>}
      {ticket.status === "done" && <span className="student-group">Приём: {durationLabel(serviceSeconds(ticket))}</span>}
    </td>
    <td className="muted">{time(ticket.createdAt)}</td>
    <td><span className={`ticket-status ${ticket.status}`}>{statusNames[ticket.status]}</span></td>
  </>;
}

function WaitingRow({ ticket, disabled }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: ticket.id, disabled });
  return <tr ref={setNodeRef} className={isDragging ? "queue-row-dragging" : ""}
    style={{ transform: CSS.Transform.toString(transform && { ...transform, x: 0 }), transition }}>
    <td className="queue-grip-cell"><button type="button" ref={setActivatorNodeRef}
      className="queue-grip" disabled={disabled} {...attributes} {...listeners}
      aria-label={`Переместить: ${ticket.name}, ${ticket.number}`}
      title="Перетащите для изменения порядка. С клавиатуры: пробел, затем стрелки.">
      <GripVertical size={20} />
    </button></td>
    <TicketCells ticket={ticket} />
  </tr>;
}

export function TeacherQueue({ tickets, history, disabled, onMove }) {
  const [activeId, setActiveId] = useState(null);
  const waiting = tickets.filter(t => t.status === "waiting");
  const active = waiting.find(t => t.id === activeId);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const label = (id) => tickets.find(t => t.id === id)?.number || "Студент";
  const accessibility = {
    screenReaderInstructions: { draggable: "Нажмите пробел, чтобы переместить студента. Стрелки вверх и вниз меняют место. Пробел сохраняет, Escape отменяет." },
    announcements: {
      onDragStart: ({ active }) => `${label(active.id)} выбран для перемещения.`,
      onDragOver: ({ over }) => over ? `Новое место: ${waiting.findIndex(t => t.id === over.id) + 1}.` : "За пределами очереди.",
      onDragEnd: ({ over }) => over ? "Сохраняем порядок очереди." : "Перемещение отменено.",
      onDragCancel: () => "Перемещение отменено.",
    },
  };
  function finishDrag({ active, over }) {
    setActiveId(null);
    if (disabled || !over || active.id === over.id) return;
    const from = waiting.findIndex(t => t.id === active.id), to = waiting.findIndex(t => t.id === over.id);
    if (from < 0 || to < 0) return;
    const moved = arrayMove(waiting, from, to);
    // Send only one move, so new enrollments and other teachers' changes cannot be overwritten.
    onMove(active.id, moved[to + 1]?.id ?? null);
  }
  return <DndContext sensors={sensors} collisionDetection={closestCenter} accessibility={accessibility}
    onDragStart={({ active }) => setActiveId(active.id)} onDragCancel={() => setActiveId(null)} onDragEnd={finishDrag}>
    {!history && waiting.length > 1 && <p className="queue-order-hint"><GripVertical size={17} /> Перетащите за точки, чтобы изменить порядок вызова</p>}
    <div className="table-wrap" aria-busy={disabled}>
      <table className={`teacher-queue-table ${history ? "" : "teacher-queue-sortable"}`}>
        <thead><tr>{!history && <th className="queue-grip-cell"><span className="visually-hidden">Порядок</span></th>}
          <th>Номер</th><th>Студент</th><th>Записался</th><th>Статус</th>
        </tr></thead>
        <tbody>
          <SortableContext items={waiting.map(t => t.id)} strategy={verticalListSortingStrategy}>
            {tickets.map(ticket => !history && ticket.status === "waiting"
              ? <WaitingRow key={ticket.id} ticket={ticket} disabled={disabled || waiting.length < 2} />
              : <tr key={ticket.id} className={ticket.status === "called" ? "called-row" : ""}>
                  {!history && <td className="queue-grip-cell" />}
                  <TicketCells ticket={ticket} />
                </tr>)}
          </SortableContext>
        </tbody>
      </table>
    </div>
    {createPortal(<DragOverlay dropAnimation={null}>
      {active ? <div className="queue-drag-preview"><GripVertical size={20} /><strong>{active.number}</strong><span>{active.name}</span></div> : null}
    </DragOverlay>, document.body)}
  </DndContext>;
}
