import type { Card } from "@/lib/kanban";

type KanbanCardPreviewProps = {
  card: Card;
};

export const KanbanCardPreview = ({ card }: KanbanCardPreviewProps) => (
  <article className="rounded-[28px] border border-[rgba(3,33,71,0.08)] bg-[linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(242,247,252,0.94))] px-5 py-5 shadow-[0_28px_48px_rgba(3,33,71,0.18)]">
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent-yellow)]" />
      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--gray-text)]">
        Drag Preview
      </p>
    </div>
    <h4 className="mt-3 font-display text-lg font-semibold text-[var(--navy-dark)]">
      {card.title}
    </h4>
    <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
      {card.details}
    </p>
  </article>
);
