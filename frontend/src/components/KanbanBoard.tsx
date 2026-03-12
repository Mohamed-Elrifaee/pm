"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";

import {
  closestCorners,
  DndContext,
  DragOverlay,
  MouseSensor,
  PointerSensor,
  pointerWithin,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { KanbanColumn } from "@/components/KanbanColumn";
import {
  addColumn,
  createId,
  initialData,
  moveCard,
  removeColumn,
  type BoardData,
} from "@/lib/kanban";

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

const columnAccentMap: Record<string, string> = {
  "col-backlog": "bg-[linear-gradient(135deg,_rgba(236,173,10,0.2),_rgba(236,173,10,0.02))]",
  "col-discovery": "bg-[linear-gradient(135deg,_rgba(32,157,215,0.2),_rgba(32,157,215,0.02))]",
  "col-progress": "bg-[linear-gradient(135deg,_rgba(117,57,145,0.16),_rgba(117,57,145,0.02))]",
  "col-review": "bg-[linear-gradient(135deg,_rgba(3,33,71,0.14),_rgba(3,33,71,0.01))]",
  "col-done": "bg-[linear-gradient(135deg,_rgba(47,142,96,0.16),_rgba(47,142,96,0.02))]",
};

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
  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const lastOverIdRef = useRef<string | null>(null);
  const currentBoard = board ?? localBoard;
  const onChange = onBoardChange ?? setLocalBoard;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(MouseSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const cardsById = useMemo(() => currentBoard.cards, [currentBoard.cards]);
  const totalCardCount = Object.keys(currentBoard.cards).length;
  const busiestColumn = [...currentBoard.columns].sort(
    (left, right) => right.cardIds.length - left.cardIds.length
  )[0];

  const collisionDetection: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }
    return closestCorners(args);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
    lastOverIdRef.current = event.active.id as string;
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (event.over?.id) {
      lastOverIdRef.current = event.over.id as string;
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);
    const resolvedOverId = (over?.id as string | undefined) ?? lastOverIdRef.current;
    lastOverIdRef.current = null;

    if (!resolvedOverId || active.id === resolvedOverId) {
      return;
    }

    const nextBoard = {
      ...currentBoard,
      columns: moveCard(currentBoard.columns, active.id as string, resolvedOverId),
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

  const handleAddColumn = () => {
    const nextBoard = {
      ...currentBoard,
      columns: addColumn(currentBoard.columns),
    };
    onChange(nextBoard);
  };

  const handleRemoveColumn = (columnId: string) => {
    const nextBoard = {
      ...currentBoard,
      columns: removeColumn(currentBoard.columns, columnId),
    };
    onChange(nextBoard);
  };

  const activeCard = activeCardId ? cardsById[activeCardId] : null;

  return (
    <div className="relative overflow-hidden">
      <div className="float-orbit pointer-events-none absolute left-[-120px] top-[-80px] h-[300px] w-[300px] rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.34)_0%,_rgba(32,157,215,0.08)_58%,_transparent_72%)]" />
      <div className="float-orbit pointer-events-none absolute right-[-140px] top-[110px] h-[280px] w-[280px] rounded-full bg-[radial-gradient(circle,_rgba(236,173,10,0.28)_0%,_rgba(236,173,10,0.06)_58%,_transparent_72%)] [animation-delay:1.8s]" />
      <div className="pointer-events-none absolute bottom-[-120px] left-[22%] h-[340px] w-[340px] rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.04)_58%,_transparent_74%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-[1540px] flex-col gap-8 px-4 pb-24 pt-6 sm:px-6 lg:px-8">
        <header className="panel-shell rise-in soft-grid relative overflow-hidden rounded-[36px] px-6 py-6 sm:px-8 sm:py-8">
          <div className="relative z-10 grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_360px]">
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full border border-[rgba(3,33,71,0.08)] bg-[rgba(255,255,255,0.8)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                  Single Board Kanban
                </span>
                <span className="rounded-full bg-[rgba(236,173,10,0.15)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--navy-dark)]">
                  Command Center
                </span>
              </div>

              <div className="max-w-3xl">
                <h1 className="font-display text-4xl font-semibold leading-tight text-[var(--navy-dark)] sm:text-5xl">
                  Kanban Studio
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--gray-text)] sm:text-[15px]">
                  A brighter control room for the project. Lanes can grow or shrink with the work,
                  cards stay tactile, and the AI helper is available on demand instead of owning a
                  permanent slice of the layout.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <article className="rounded-[26px] border border-[rgba(3,33,71,0.08)] bg-[rgba(255,255,255,0.78)] px-5 py-4 shadow-[0_16px_36px_rgba(3,33,71,0.08)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--gray-text)]">
                    Total Cards
                  </p>
                  <p className="mt-3 font-display text-3xl font-semibold text-[var(--navy-dark)]">
                    {totalCardCount}
                  </p>
                </article>
                <article className="rounded-[26px] border border-[rgba(3,33,71,0.08)] bg-[rgba(255,255,255,0.78)] px-5 py-4 shadow-[0_16px_36px_rgba(3,33,71,0.08)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--gray-text)]">
                    Active Lanes
                  </p>
                  <p className="mt-3 font-display text-3xl font-semibold text-[var(--navy-dark)]">
                    {currentBoard.columns.length}
                  </p>
                </article>
                <article className="rounded-[26px] border border-[rgba(3,33,71,0.08)] bg-[rgba(255,255,255,0.78)] px-5 py-4 shadow-[0_16px_36px_rgba(3,33,71,0.08)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--gray-text)]">
                    Busiest Stage
                  </p>
                  <p className="mt-3 truncate font-display text-2xl font-semibold text-[var(--navy-dark)]">
                    {busiestColumn?.title ?? "None"}
                  </p>
                </article>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {currentBoard.columns.map((column) => (
                  <div
                    key={column.id}
                    className={`rounded-full border border-[rgba(3,33,71,0.08)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--navy-dark)] ${columnAccentMap[column.id] ?? "bg-[rgba(255,255,255,0.72)]"}`}
                  >
                    {column.title}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[30px] border border-[rgba(3,33,71,0.1)] bg-[linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,251,255,0.82))] p-5 shadow-[0_22px_44px_rgba(3,33,71,0.12)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--gray-text)]">
                    Focus
                  </p>
                  <p className="mt-2 font-display text-2xl font-semibold text-[var(--navy-dark)]">
                    One board. Flexible lanes.
                  </p>
                </div>
                <div className="rounded-full bg-[rgba(32,157,215,0.14)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--primary-blue)]">
                  Live
                </div>
              </div>

              <div className="mt-5 space-y-3 text-sm text-[var(--gray-text)]">
                <div className="flex items-center justify-between rounded-2xl bg-[rgba(3,33,71,0.04)] px-4 py-3">
                  <span>Signed in</span>
                  <span className="font-semibold text-[var(--navy-dark)]">{username ?? "Guest"}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-[rgba(3,33,71,0.04)] px-4 py-3">
                  <span>Board status</span>
                  <span className="font-semibold text-[var(--navy-dark)]">
                    {isSavingBoard ? "Syncing..." : "Ready"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-[rgba(3,33,71,0.04)] px-4 py-3">
                  <span>AI lane</span>
                  <span className="font-semibold text-[var(--navy-dark)]">
                    {chatSidebar ? (isAgentOpen ? "Open" : "Docked") : "Hidden"}
                  </span>
                </div>
              </div>

              {onLogout ? (
                <button
                  type="button"
                  onClick={onLogout}
                  className="mt-6 w-full rounded-full border border-[rgba(3,33,71,0.12)] bg-white px-4 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--navy-dark)] transition hover:-translate-y-0.5 hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]"
                >
                  Log out
                </button>
              ) : null}
            </div>
          </div>

          {boardError ? (
            <p className="relative z-10 mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600" role="alert">
              {boardError}
            </p>
          ) : null}
        </header>

        <div className="rise-in [animation-delay:120ms]">
          <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[var(--gray-text)]">
                Board Lanes
              </p>
              <p className="mt-2 text-sm text-[var(--gray-text)]">
                Add a lane when the workflow expands. Remove one and its cards move to the nearest
                remaining lane.
              </p>
            </div>

            <button
              type="button"
              onClick={handleAddColumn}
              className="shrink-0 rounded-full bg-[linear-gradient(135deg,_var(--primary-blue),_#5dbbe4)] px-5 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-white shadow-[0_18px_30px_rgba(32,157,215,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_38px_rgba(32,157,215,0.32)]"
            >
              Add column
            </button>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <section className="flex gap-5 overflow-x-auto pb-4">
              {currentBoard.columns.map((column, index) => (
                <div
                  key={column.id}
                  className="rise-in w-[min(330px,86vw)] shrink-0"
                  style={{ animationDelay: `${index * 70 + 120}ms` }}
                >
                  <KanbanColumn
                    column={column}
                    cards={column.cardIds.map((cardId) => currentBoard.cards[cardId])}
                    onRename={handleRenameColumn}
                    onAddCard={handleAddCard}
                    onDeleteCard={handleDeleteCard}
                    onRemove={handleRemoveColumn}
                    canRemove={currentBoard.columns.length > 1}
                  />
                </div>
              ))}
            </section>
            <DragOverlay>
              {activeCard ? (
                <div className="w-[280px]">
                  <KanbanCardPreview card={activeCard} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </main>

      {chatSidebar ? (
        <div className="pointer-events-none fixed bottom-5 right-4 z-40 flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-3 sm:bottom-6 sm:right-6">
          {isAgentOpen ? (
            <aside
              id="board-agent-panel"
              className="panel-shell pointer-events-auto rise-in w-[min(390px,calc(100vw-1.5rem))] rounded-[32px] p-5"
              data-testid="chat-sidebar"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--gray-text)]">
                    Support Desk
                  </p>
                  <p className="mt-2 font-display text-2xl font-semibold text-[var(--navy-dark)]">
                    Board agent
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAgentOpen(false)}
                  className="rounded-full border border-[rgba(3,33,71,0.08)] bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)] transition hover:border-[rgba(3,33,71,0.16)] hover:text-[var(--navy-dark)]"
                  aria-label="Hide board assistant"
                >
                  Close
                </button>
              </div>
              {chatSidebar}
            </aside>
          ) : null}

          <button
            type="button"
            onClick={() => setIsAgentOpen((current) => !current)}
            className="pointer-events-auto flex items-center gap-3 rounded-full border border-[rgba(3,33,71,0.1)] bg-[linear-gradient(135deg,_rgba(255,255,255,0.96),_rgba(240,245,252,0.94))] px-4 py-3 shadow-[0_22px_42px_rgba(3,33,71,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_28px_48px_rgba(3,33,71,0.22)]"
            aria-controls="board-agent-panel"
            aria-expanded={isAgentOpen}
            aria-label={isAgentOpen ? "Hide board assistant" : "Open board assistant"}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,_var(--secondary-purple),_#8b56a4)] text-xs font-semibold uppercase tracking-[0.18em] text-white shadow-[0_12px_24px_rgba(117,57,145,0.3)]">
              AI
            </span>
            <span className="text-left">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--gray-text)]">
                Support
              </span>
              <span className="mt-1 block text-sm font-semibold text-[var(--navy-dark)]">
                {isAgentOpen ? "Hide agent" : "Talk to agent"}
              </span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
};
