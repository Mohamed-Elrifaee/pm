"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  ChatSidebar,
  type ChatMessage,
  type ChatOperation,
} from "@/components/ChatSidebar";
import { KanbanBoard } from "@/components/KanbanBoard";
import type { BoardData } from "@/lib/kanban";

type SessionResponse = {
  authenticated: boolean;
  username: string | null;
};

type LoginState = {
  username: string;
  password: string;
};

type BoardResponse = {
  board: BoardData;
  version: number;
};

type ChatHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

type ChatResponse = {
  message: string;
  operations: ChatOperation[];
  board: BoardData;
  version: number;
};

const defaultLoginState: LoginState = {
  username: "",
  password: "",
};

const cloneBoard = (source: BoardData): BoardData => ({
  columns: source.columns.map((column) => ({ ...column, cardIds: [...column.cardIds] })),
  cards: Object.fromEntries(Object.entries(source.cards).map(([id, card]) => [id, { ...card }])),
});

class SaveBoardError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const readSession = async (): Promise<SessionResponse> => {
  const response = await fetch("/api/session", {
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to read session.");
  }

  return response.json();
};

const readBoard = async (): Promise<BoardResponse> => {
  const response = await fetch("/api/board", {
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to read board.");
  }

  return response.json();
};

const writeBoard = async (board: BoardData, version: number): Promise<BoardResponse> => {
  const response = await fetch("/api/board", {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ board, version }),
  });

  if (!response.ok) {
    throw new SaveBoardError(response.status, "Failed to save board.");
  }

  return response.json();
};

const sendChatMessage = async (
  message: string,
  history: ChatHistoryItem[]
): Promise<ChatResponse> => {
  const response = await fetch("/api/chat", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, history }),
  });

  if (!response.ok) {
    throw new Error("Failed to get AI response.");
  }

  return response.json();
};

const createMessageId = (): string =>
  `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const AppShell = () => {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginState, setLoginState] = useState<LoginState>(defaultLoginState);
  const [board, setBoard] = useState<BoardData | null>(null);
  const [isBoardLoading, setIsBoardLoading] = useState(false);
  const [isBoardSaving, setIsBoardSaving] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [pendingChatMessage, setPendingChatMessage] = useState<ChatMessage | null>(null);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatSubmitting, setIsChatSubmitting] = useState(false);

  const boardVersionRef = useRef<number | null>(null);
  const confirmedBoardRef = useRef<BoardData | null>(null);
  const queuedBoardRef = useRef<BoardData | null>(null);
  const isBoardSaveLoopRunningRef = useRef(false);

  const applyConfirmedBoard = (nextBoard: BoardData, nextVersion: number) => {
    const confirmedBoard = cloneBoard(nextBoard);
    confirmedBoardRef.current = confirmedBoard;
    boardVersionRef.current = nextVersion;
    setBoard(confirmedBoard);
  };

  const resetBoardState = () => {
    boardVersionRef.current = null;
    confirmedBoardRef.current = null;
    queuedBoardRef.current = null;
    isBoardSaveLoopRunningRef.current = false;
    setBoard(null);
    setBoardError(null);
    setIsBoardSaving(false);
  };

  const loadBoard = async () => {
    setBoardError(null);
    setIsBoardLoading(true);

    try {
      const boardResponse = await readBoard();
      applyConfirmedBoard(boardResponse.board, boardResponse.version);
    } catch {
      setBoardError("Unable to load board right now. Please retry.");
    } finally {
      setIsBoardLoading(false);
    }
  };

  const flushBoardSaveQueue = async () => {
    if (isBoardSaveLoopRunningRef.current || boardVersionRef.current === null || !queuedBoardRef.current) {
      return;
    }

    isBoardSaveLoopRunningRef.current = true;
    setIsBoardSaving(true);

    try {
      while (queuedBoardRef.current && boardVersionRef.current !== null) {
        const boardToSave = cloneBoard(queuedBoardRef.current);
        const versionToSave = boardVersionRef.current;
        queuedBoardRef.current = null;

        try {
          const saved = await writeBoard(boardToSave, versionToSave);
          const hasNewerBoardQueued = queuedBoardRef.current !== null;
          confirmedBoardRef.current = cloneBoard(saved.board);
          boardVersionRef.current = saved.version;
          if (!hasNewerBoardQueued) {
            setBoard(cloneBoard(saved.board));
          }
          setBoardError(null);
        } catch (error) {
          if (queuedBoardRef.current) {
            continue;
          }

          if (error instanceof SaveBoardError && error.status === 409) {
            try {
              const latestBoard = await readBoard();
              applyConfirmedBoard(latestBoard.board, latestBoard.version);
              setBoardError("Board changed before this save completed. Latest board loaded.");
            } catch {
              setBoardError(
                "Board changed before this save completed, and the latest board could not be loaded."
              );
            }
          } else {
            const confirmedBoard = confirmedBoardRef.current;
            if (confirmedBoard) {
              setBoard(cloneBoard(confirmedBoard));
            }
            setBoardError("We could not save this change. Please try again.");
          }
          break;
        }
      }
    } finally {
      isBoardSaveLoopRunningRef.current = false;
      setIsBoardSaving(false);
      if (queuedBoardRef.current) {
        void flushBoardSaveQueue();
      }
    }
  };

  useEffect(() => {
    let isMounted = true;

    const loadSession = async () => {
      try {
        const nextSession = await readSession();
        if (isMounted) {
          setSession(nextSession);
        }
      } catch {
        if (isMounted) {
          setSession({ authenticated: false, username: null });
          setError("Unable to verify session. Please try signing in.");
        }
      } finally {
        if (isMounted) {
          setIsCheckingSession(false);
        }
      }
    };

    void loadSession();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!session?.authenticated) {
      resetBoardState();
      setChatMessages([]);
      setPendingChatMessage(null);
      setChatDraft("");
      setChatError(null);
      setIsChatSubmitting(false);
      return;
    }

    void loadBoard();
  }, [session?.authenticated]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(loginState),
      });

      if (!response.ok) {
        setError("Invalid username or password.");
        return;
      }

      const nextSession = (await response.json()) as SessionResponse;
      setSession(nextSession);
      setLoginState(defaultLoginState);
    } catch {
      setError("Sign in failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      await fetch("/api/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setSession({ authenticated: false, username: null });
      resetBoardState();
      setChatMessages([]);
      setPendingChatMessage(null);
      setChatDraft("");
      setChatError(null);
      setIsChatSubmitting(false);
      setIsSubmitting(false);
    }
  };

  const handleBoardChange = async (nextBoard: BoardData) => {
    const optimisticBoard = cloneBoard(nextBoard);
    setBoard(optimisticBoard);
    setBoardError(null);
    queuedBoardRef.current = optimisticBoard;
    await flushBoardSaveQueue();
  };

  const handleChatSubmit = async () => {
    if (!board) {
      return;
    }

    const trimmedMessage = chatDraft.trim();
    if (!trimmedMessage) {
      return;
    }

    const history: ChatHistoryItem[] = chatMessages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: trimmedMessage,
    };

    setPendingChatMessage(userMessage);
    setChatDraft("");
    setChatError(null);
    setIsChatSubmitting(true);

    try {
      const response = await sendChatMessage(trimmedMessage, history);
      applyConfirmedBoard(response.board, response.version);
      setBoardError(null);
      setChatMessages((prev) => [
        ...prev,
        userMessage,
        {
          id: createMessageId(),
          role: "assistant",
          content: response.message,
          operations: response.operations,
        },
      ]);
      setPendingChatMessage(null);
    } catch {
      setPendingChatMessage(null);
      setChatDraft(trimmedMessage);
      setChatError("Unable to get AI response right now. Please try again.");
    } finally {
      setIsChatSubmitting(false);
    }
  };

  const renderedChatMessages = pendingChatMessage
    ? [...chatMessages, pendingChatMessage]
    : chatMessages;

  if (isCheckingSession) {
    return (
      <main className="mx-auto flex min-h-screen max-w-[640px] items-center justify-center px-6">
        <section className="panel-shell rise-in w-full rounded-[34px] px-8 py-12 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
            Project Management MVP
          </p>
          <h1 className="mt-4 font-display text-4xl font-semibold text-[var(--navy-dark)]">
            Preparing your workspace
          </h1>
          <p className="mt-4 text-sm leading-7 text-[var(--gray-text)]">
            Checking session...
          </p>
        </section>
      </main>
    );
  }

  if (session?.authenticated) {
    if (isBoardLoading || !board) {
      return (
        <main className="mx-auto flex min-h-screen max-w-[640px] items-center justify-center px-6">
          <div className="panel-shell rise-in w-full rounded-[34px] px-8 py-12 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
              Board Sync
            </p>
            <h1 className="mt-4 font-display text-4xl font-semibold text-[var(--navy-dark)]">
              Loading board...
            </h1>
            {boardError ? (
              <div className="mt-4 space-y-3">
                <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                  {boardError}
                </p>
                <button
                  type="button"
                  onClick={() => void loadBoard()}
                  className="rounded-full border border-[rgba(3,33,71,0.12)] bg-white px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--navy-dark)] transition hover:-translate-y-0.5 hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]"
                >
                  Retry
                </button>
              </div>
            ) : null}
          </div>
        </main>
      );
    }

    return (
      <KanbanBoard
        onLogout={handleLogout}
        username={session.username}
        board={board}
        onBoardChange={(next) => void handleBoardChange(next)}
        boardError={boardError}
        isSavingBoard={isBoardSaving}
        chatSidebar={
          <ChatSidebar
            messages={renderedChatMessages}
            draft={chatDraft}
            isSubmitting={isChatSubmitting}
            error={chatError}
            onDraftChange={setChatDraft}
            onSubmit={() => void handleChatSubmit()}
          />
        }
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[1280px] items-center px-4 py-10 sm:px-6">
      <section className="grid w-full gap-6 lg:grid-cols-[minmax(0,1.1fr)_480px]">
        <div className="panel-shell rise-in soft-grid relative overflow-hidden rounded-[38px] p-8 sm:p-10">
          <div className="relative z-10">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-[rgba(3,33,71,0.08)] bg-[rgba(255,255,255,0.82)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.32em] text-[var(--gray-text)]">
                Project Management MVP
              </span>
              <span className="rounded-full bg-[rgba(236,173,10,0.15)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--navy-dark)]">
                Local Workspace
              </span>
            </div>

            <h1 className="mt-6 max-w-2xl font-display text-4xl font-semibold leading-tight text-[var(--navy-dark)] sm:text-5xl">
              Your board, with more presence
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-[var(--gray-text)] sm:text-[15px]">
              Step into the board through a cleaner launch surface. The Kanban area keeps the MVP
              simplicity, but now the workflow can expand with new lanes and the AI agent stays
              tucked to the side until you need it.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <article className="rounded-[26px] border border-[rgba(3,33,71,0.08)] bg-[rgba(255,255,255,0.76)] px-4 py-4 shadow-[0_18px_34px_rgba(3,33,71,0.08)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--gray-text)]">
                  Board Shape
                </p>
                <p className="mt-3 font-display text-2xl font-semibold text-[var(--navy-dark)]">
                  Flexible lanes
                </p>
              </article>
              <article className="rounded-[26px] border border-[rgba(3,33,71,0.08)] bg-[rgba(255,255,255,0.76)] px-4 py-4 shadow-[0_18px_34px_rgba(3,33,71,0.08)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--gray-text)]">
                  AI Actions
                </p>
                <p className="mt-3 font-display text-2xl font-semibold text-[var(--navy-dark)]">
                  Create. Move. Edit.
                </p>
              </article>
              <article className="rounded-[26px] border border-[rgba(3,33,71,0.08)] bg-[rgba(255,255,255,0.76)] px-4 py-4 shadow-[0_18px_34px_rgba(3,33,71,0.08)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--gray-text)]">
                  Access
                </p>
                <p className="mt-3 font-display text-2xl font-semibold text-[var(--navy-dark)]">
                  Demo login
                </p>
              </article>
            </div>
          </div>
        </div>

        <section className="panel-shell rise-in rounded-[38px] p-8 [animation-delay:120ms]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
            Workspace Access
          </p>
          <h2 className="mt-4 font-display text-3xl font-semibold text-[var(--navy-dark)]">
            Sign in
          </h2>
          <p className="mt-3 text-sm leading-7 text-[var(--gray-text)]">
            Use the demo credentials to enter the board.
          </p>
          <div className="mt-4 rounded-[24px] border border-[rgba(32,157,215,0.14)] bg-[rgba(32,157,215,0.08)] px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--primary-blue)]">
              Demo Credentials
            </p>
            <p className="mt-2 text-sm font-semibold text-[var(--navy-dark)]">
              Username: user
            </p>
            <p className="mt-1 text-sm font-semibold text-[var(--navy-dark)]">
              Password: password
            </p>
          </div>

          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--gray-text)]">
                Username
              </span>
              <input
                value={loginState.username}
                onChange={(event) =>
                  setLoginState((prev) => ({ ...prev, username: event.target.value }))
                }
                className="mt-3 w-full rounded-[22px] border border-[rgba(3,33,71,0.08)] bg-white px-4 py-3 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[rgba(32,157,215,0.34)]"
                required
                autoComplete="username"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--gray-text)]">
                Password
              </span>
              <input
                type="password"
                value={loginState.password}
                onChange={(event) =>
                  setLoginState((prev) => ({ ...prev, password: event.target.value }))
                }
                className="mt-3 w-full rounded-[22px] border border-[rgba(3,33,71,0.08)] bg-white px-4 py-3 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[rgba(32,157,215,0.34)]"
                required
                autoComplete="current-password"
              />
            </label>

            {error ? (
              <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600" role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              className="w-full rounded-full bg-[linear-gradient(135deg,_var(--secondary-purple),_#9157a9)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-white transition hover:-translate-y-0.5 hover:shadow-[0_18px_30px_rgba(117,57,145,0.25)] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </section>
      </section>
    </main>
  );
};
