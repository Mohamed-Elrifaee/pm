import clsx from "clsx";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import { KanbanCard } from "@/components/KanbanCard";
import { NewCardForm } from "@/components/NewCardForm";
import type { Card, Column } from "@/lib/kanban";

type KanbanColumnProps = {
  column: Column;
  cards: Card[];
  onRename: (columnId: string, title: string) => void;
  onAddCard: (columnId: string, title: string, details: string) => void;
  onDeleteCard: (columnId: string, cardId: string) => void;
  onRemove: (columnId: string) => void;
  canRemove: boolean;
};

const accentMap: Record<string, string> = {
  "col-backlog": "from-[rgba(236,173,10,0.26)] to-[rgba(236,173,10,0.04)]",
  "col-discovery": "from-[rgba(32,157,215,0.24)] to-[rgba(32,157,215,0.04)]",
  "col-progress": "from-[rgba(117,57,145,0.22)] to-[rgba(117,57,145,0.04)]",
  "col-review": "from-[rgba(3,33,71,0.16)] to-[rgba(3,33,71,0.03)]",
  "col-done": "from-[rgba(47,142,96,0.2)] to-[rgba(47,142,96,0.03)]",
};

export const KanbanColumn = ({
  column,
  cards,
  onRename,
  onAddCard,
  onDeleteCard,
  onRemove,
  canRemove,
}: KanbanColumnProps) => {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <section
      ref={setNodeRef}
      className={clsx(
        "soft-grid relative flex min-h-[540px] flex-col overflow-hidden rounded-[30px] border border-[rgba(3,33,71,0.08)] bg-[rgba(255,255,255,0.72)] p-4 shadow-[0_22px_46px_rgba(3,33,71,0.1)] transition duration-200",
        isOver && "scale-[1.01] border-[rgba(236,173,10,0.65)] shadow-[0_28px_54px_rgba(236,173,10,0.18)]"
      )}
      data-testid={`column-${column.id}`}
    >
      <div
        className={clsx(
          "absolute inset-x-0 top-0 h-28 bg-gradient-to-br opacity-90",
          accentMap[column.id] ?? "from-[rgba(32,157,215,0.16)] to-transparent"
        )}
      />

      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="w-full">
          <div className="flex items-center gap-3">
            <div className="h-2.5 w-12 rounded-full bg-[var(--accent-yellow)] shadow-[0_8px_16px_rgba(236,173,10,0.3)]" />
            <span className="rounded-full bg-[rgba(255,255,255,0.84)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--gray-text)]">
              {cards.length} cards
            </span>
          </div>

          <input
            value={column.title}
            onChange={(event) => onRename(column.id, event.target.value)}
            className="mt-4 w-full rounded-2xl border border-transparent bg-[rgba(255,255,255,0.76)] px-3 py-2 font-display text-xl font-semibold text-[var(--navy-dark)] outline-none transition focus:border-[rgba(32,157,215,0.28)] focus:bg-white"
            aria-label="Column title"
          />
        </div>

        <button
          type="button"
          onClick={() => onRemove(column.id)}
          disabled={!canRemove}
          className="rounded-full border border-[rgba(3,33,71,0.08)] bg-[rgba(255,255,255,0.82)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--gray-text)] transition hover:border-[rgba(3,33,71,0.16)] hover:text-[var(--navy-dark)] disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Remove ${column.title}`}
          title={
            canRemove
              ? "Remove this column and move its cards to the nearest lane."
              : "At least one column must remain."
          }
        >
          Remove
        </button>
      </div>

      <div className="relative z-10 mt-4 flex flex-1 flex-col gap-3">
        <SortableContext items={column.cardIds} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <KanbanCard
              key={card.id}
              card={card}
              onDelete={(cardId) => onDeleteCard(column.id, cardId)}
            />
          ))}
        </SortableContext>

        {cards.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-[24px] border border-dashed border-[rgba(3,33,71,0.12)] bg-[rgba(255,255,255,0.6)] px-4 py-8 text-center text-xs font-semibold uppercase tracking-[0.24em] text-[var(--gray-text)]">
            Drop a card here
          </div>
        )}
      </div>

      <div className="relative z-10">
        <NewCardForm onAdd={(title, details) => onAddCard(column.id, title, details)} />
      </div>
    </section>
  );
};
