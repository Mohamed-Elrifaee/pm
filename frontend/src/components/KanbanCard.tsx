import clsx from "clsx";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { Card } from "@/lib/kanban";

type KanbanCardProps = {
  card: Card;
  onDelete: (cardId: string) => void;
};

export const KanbanCard = ({ card, onDelete }: KanbanCardProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        "group rounded-[26px] border border-[rgba(3,33,71,0.08)] bg-[linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(245,248,252,0.92))] px-4 py-4 shadow-[0_18px_34px_rgba(3,33,71,0.08)]",
        "cursor-grab touch-none select-none transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_22px_40px_rgba(3,33,71,0.12)]",
        isDragging && "cursor-grabbing opacity-70 shadow-[0_28px_46px_rgba(3,33,71,0.18)]"
      )}
      {...attributes}
      {...listeners}
      data-testid={`card-${card.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--primary-blue)]" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--gray-text)]">
              Task Card
            </p>
          </div>

          <h4 className="mt-3 font-display text-[17px] font-semibold leading-6 text-[var(--navy-dark)]">
            {card.title}
          </h4>
          <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
            {card.details}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onDelete(card.id)}
          className="rounded-full border border-transparent bg-[rgba(3,33,71,0.04)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)] transition hover:border-[rgba(3,33,71,0.12)] hover:bg-white hover:text-[var(--navy-dark)]"
          aria-label={`Delete ${card.title}`}
        >
          Remove
        </button>
      </div>
    </article>
  );
};
