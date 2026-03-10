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
  user: "self-end border-[var(--primary-blue)] bg-[rgba(32,157,215,0.1)] text-[var(--navy-dark)]",
  assistant:
    "self-start border-[var(--secondary-purple)] bg-[rgba(117,57,145,0.1)] text-[var(--navy-dark)]",
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
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--gray-text)]">
          AI Chat
        </p>
        <h2 className="mt-2 font-display text-2xl font-semibold text-[var(--navy-dark)]">
          Board Assistant
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
          Ask AI to create, edit, move, or delete cards. Board updates apply automatically.
        </p>
      </header>

      <div
        className="mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] p-3"
        data-testid="chat-messages"
      >
        {messages.length === 0 ? (
          <p className="my-auto px-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-[var(--gray-text)]">
            No messages yet
          </p>
        ) : null}
        {messages.map((message) => (
          <article
            key={message.id}
            className={`max-w-[92%] rounded-2xl border px-3 py-2 text-sm leading-6 ${roleClassMap[message.role]}`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
              {message.role === "user" ? "You" : "Assistant"}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{message.content}</p>
            {message.role === "assistant" && message.operations && message.operations.length > 0 ? (
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--secondary-purple)]">
                Applied {message.operations.length} operation
                {message.operations.length === 1 ? "" : "s"}
              </p>
            ) : null}
          </article>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
          Message
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="Example: Move card-2 to In Progress"
            className="mt-2 h-28 w-full resize-none rounded-2xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
            aria-label="AI message"
          />
        </label>
        {error ? (
          <p className="text-sm font-semibold text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={isSubmitting || draft.trim().length === 0}
          className="w-full rounded-full bg-[var(--secondary-purple)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Sending..." : "Send"}
        </button>
      </form>
    </div>
  );
};
