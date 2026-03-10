"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  pointerWithin,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { createId, initialData, moveCard, type BoardData } from "@/lib/kanban";

type KanbanBoardProps = {
  onLogout?: () => void;
  username?: string | null;
  board?: BoardData;
  onBoardChange?: (nextBoard: BoardData) => void;
  boardError?: string | null;
  isSavingBoard?: boolean;
  chatSidebar?: ReactNode;
};

const cloneBoard = (source: BoardData): BoardData => ({
  columns: source.columns.map((column) => ({ ...column, cardIds: [...column.cardIds] })),
  cards: Object.fromEntries(Object.entries(source.cards).map(([id, card]) => [id, { ...card }])),
});

export const KanbanBoard = ({
  onLogout,
  username,
  board,
  onBoardChange,
  boardError,
  isSavingBoard,
  chatSidebar,
}: KanbanBoardProps) => {
  const [localBoard, setLocalBoard] = useState<BoardData>(() => cloneBoard(initialData));
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const currentBoard = board ?? localBoard;
  const onChange = onBoardChange ?? setLocalBoard;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const cardsById = useMemo(() => currentBoard.cards, [currentBoard.cards]);

  const collisionDetection: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }
    return closestCorners(args);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (!over || active.id === over.id) {
      return;
    }

    const nextBoard = {
      ...currentBoard,
      columns: moveCard(currentBoard.columns, active.id as string, over.id as string),
    };
    onChange(nextBoard);
  };

  const handleRenameColumn = (columnId: string, title: string) => {
    const nextBoard = {
      ...currentBoard,
      columns: currentBoard.columns.map((column) =>
        column.id === columnId ? { ...column, title } : column
      ),
    };
    onChange(nextBoard);
  };

  const handleAddCard = (columnId: string, title: string, details: string) => {
    const id = createId("card");
    const nextBoard = {
      ...currentBoard,
      cards: {
        ...currentBoard.cards,
        [id]: { id, title, details: details || "No details yet." },
      },
      columns: currentBoard.columns.map((column) =>
        column.id === columnId
          ? { ...column, cardIds: [...column.cardIds, id] }
          : column
      ),
    };
    onChange(nextBoard);
  };

  const handleDeleteCard = (columnId: string, cardId: string) => {
    const nextBoard = {
      ...currentBoard,
      cards: Object.fromEntries(
        Object.entries(currentBoard.cards).filter(([id]) => id !== cardId)
      ),
      columns: currentBoard.columns.map((column) =>
        column.id === columnId
          ? {
              ...column,
              cardIds: column.cardIds.filter((id) => id !== cardId),
            }
          : column
      ),
    };
    onChange(nextBoard);
  };

  const activeCard = activeCardId ? cardsById[activeCardId] : null;

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-[1500px] flex-col gap-10 px-6 pb-16 pt-12">
        <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Single Board Kanban
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                Kanban Studio
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                Keep momentum visible. Rename columns, drag cards between stages,
                and capture quick notes without getting buried in settings.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                Focus
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--primary-blue)]">
                One board. Five columns. Zero clutter.
              </p>
              {username ? (
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
                  Signed in as {username}
                </p>
              ) : null}
              {isSavingBoard ? (
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--primary-blue)]">
                  Saving...
                </p>
              ) : null}
              {onLogout ? (
                <button
                  type="button"
                  onClick={onLogout}
                  className="mt-3 rounded-full border border-[var(--stroke)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]"
                >
                  Log out
                </button>
              ) : null}
            </div>
          </div>
          {boardError ? (
            <p className="text-sm font-semibold text-red-600" role="alert">
              {boardError}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-4">
            {currentBoard.columns.map((column) => (
              <div
                key={column.id}
                className="flex items-center gap-2 rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
              >
                <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                {column.title}
              </div>
            ))}
          </div>
        </header>

        <div className={chatSidebar ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]" : ""}>
          <div>
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <section className="grid gap-6 lg:grid-cols-5">
                {currentBoard.columns.map((column) => (
                  <KanbanColumn
                    key={column.id}
                    column={column}
                    cards={column.cardIds.map((cardId) => currentBoard.cards[cardId])}
                    onRename={handleRenameColumn}
                    onAddCard={handleAddCard}
                    onDeleteCard={handleDeleteCard}
                  />
                ))}
              </section>
              <DragOverlay>
                {activeCard ? (
                  <div className="w-[260px]">
                    <KanbanCardPreview card={activeCard} />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
          {chatSidebar ? (
            <aside
              className="h-fit rounded-[28px] border border-[var(--stroke)] bg-white/90 p-5 shadow-[var(--shadow)] backdrop-blur xl:sticky xl:top-6"
              data-testid="chat-sidebar"
            >
              {chatSidebar}
            </aside>
          ) : null}
        </div>
      </main>
    </div>
  );
};
