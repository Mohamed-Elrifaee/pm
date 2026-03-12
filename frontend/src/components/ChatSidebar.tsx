"use client";

import type { FormEvent } from "react";

type ChatRole = "user" | "assistant";

export type ChatOperationType = "create" | "edit" | "move" | "delete";

export type ChatOperation = {
  type: ChatOperationType;
  cardId?: string;
  columnId?: string;
  title?: string;
  details?: string;
  index?: number;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  operations?: ChatOperation[];
};

type ChatSidebarProps = {
  messages: ChatMessage[];
  draft: string;
  isSubmitting: boolean;
  error: string | null;
  onDraftChange: (nextDraft: string) => void;
  onSubmit: () => void;
};

const roleClassMap: Record<ChatRole, string> = {
  user: "self-end border-[rgba(32,157,215,0.18)] bg-[linear-gradient(135deg,_rgba(32,157,215,0.14),_rgba(32,157,215,0.06))] text-[var(--navy-dark)]",
  assistant:
    "self-start border-[rgba(117,57,145,0.18)] bg-[linear-gradient(135deg,_rgba(117,57,145,0.16),_rgba(255,255,255,0.9))] text-[var(--navy-dark)]",
};

export const ChatSidebar = ({
  messages,
  draft,
  isSubmitting,
  error,
  onDraftChange,
  onSubmit,
}: ChatSidebarProps) => {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <div className="flex min-h-[640px] flex-col">
      <header className="rounded-[26px] border border-[rgba(3,33,71,0.08)] bg-[linear-gradient(180deg,_rgba(255,255,255,0.9),_rgba(244,248,253,0.82))] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[var(--gray-text)]">
              AI Chat
            </p>
            <h2 className="mt-2 font-display text-2xl font-semibold text-[var(--navy-dark)]">
              Board Assistant
            </h2>
          </div>
          <span className="rounded-full bg-[rgba(236,173,10,0.16)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--navy-dark)]">
            Automation
          </span>
        </div>

        <p className="mt-3 text-sm leading-6 text-[var(--gray-text)]">
          Ask AI to create, edit, move, or delete cards. Responses are designed to feel like a
          teammate, not a hidden settings panel.
        </p>
      </header>

      <div
        className="mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-[28px] border border-[rgba(3,33,71,0.08)] bg-[rgba(248,250,253,0.82)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
        data-testid="chat-messages"
      >
        {messages.length === 0 ? (
          <div className="my-auto rounded-[24px] border border-dashed border-[rgba(3,33,71,0.12)] bg-[rgba(255,255,255,0.72)] px-4 py-8 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--gray-text)]">
              No messages yet
            </p>
            <p className="mt-2 text-sm text-[var(--gray-text)]">
              Try: "Create a weekly report card in Backlog"
            </p>
          </div>
        ) : null}

        {messages.map((message) => (
          <article
            key={message.id}
            className={`max-w-[92%] rounded-[24px] border px-4 py-3 text-sm leading-6 shadow-[0_18px_32px_rgba(3,33,71,0.07)] ${roleClassMap[message.role]}`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
              {message.role === "user" ? "You" : "Assistant"}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{message.content}</p>
            {message.role === "assistant" && message.operations && message.operations.length > 0 ? (
              <p className="mt-3 rounded-full bg-[rgba(255,255,255,0.72)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--secondary-purple)]">
                Applied {message.operations.length} operation
                {message.operations.length === 1 ? "" : "s"}
              </p>
            ) : null}
          </article>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3 rounded-[28px] border border-[rgba(3,33,71,0.08)] bg-[rgba(255,255,255,0.78)] p-4">
        <label className="block text-xs font-semibold uppercase tracking-[0.22em] text-[var(--gray-text)]">
          Message
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="Example: Move card-2 to In Progress"
            className="mt-3 h-28 w-full resize-none rounded-[22px] border border-[rgba(3,33,71,0.08)] bg-white px-4 py-3 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[rgba(32,157,215,0.34)]"
            aria-label="AI message"
          />
        </label>
        {error ? (
          <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={isSubmitting || draft.trim().length === 0}
          className="w-full rounded-full bg-[linear-gradient(135deg,_var(--secondary-purple),_#9157a9)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-white transition hover:-translate-y-0.5 hover:shadow-[0_18px_30px_rgba(117,57,145,0.25)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Sending..." : "Send"}
        </button>
      </form>
    </div>
  );
};
