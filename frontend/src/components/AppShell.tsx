"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  ChatSidebar,
  type ChatMessage,
  type ChatOperation,
} from "@/components/ChatSidebar";
import { KanbanBoard } from "@/components/KanbanBoard";
import type { BoardData } from "@/lib/kanban";

type UserProfile = {
  id: number;
  fullName: string;
  username: string;
  email: string;
};

type SessionResponse = {
  authenticated: boolean;
  user: UserProfile | null;
};

type Workspace = {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type WorkspacesResponse = {
  workspaces: Workspace[];
  selectedWorkspaceId?: number;
};

type LoginState = {
  identifier: string;
  password: string;
};

type SignupState = {
  fullName: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
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
  workspaces: Workspace[];
  selectedWorkspaceId: number;
  board: BoardData;
  version: number;
};

const defaultLoginState: LoginState = {
  identifier: "",
  password: "",
};

const defaultSignupState: SignupState = {
  fullName: "",
  username: "",
  email: "",
  password: "",
  confirmPassword: "",
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

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload.detail === "string" && payload.detail.trim().length > 0) {
      return payload.detail;
    }
  } catch {
    return fallback;
  }

  return fallback;
};

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

const readWorkspaces = async (): Promise<WorkspacesResponse> => {
  const response = await fetch("/api/workspaces", {
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to read workspaces.");
  }

  return response.json();
};

const createWorkspaceRequest = async (name: string): Promise<{ workspace: Workspace }> => {
  const response = await fetch("/api/workspaces", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to create workspace."));
  }

  return response.json();
};

const renameWorkspaceRequest = async (
  workspaceId: number,
  name: string
): Promise<{ workspace: Workspace }> => {
  const response = await fetch(`/api/workspaces/${workspaceId}`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to rename workspace."));
  }

  return response.json();
};

const deleteWorkspaceRequest = async (workspaceId: number): Promise<WorkspacesResponse> => {
  const response = await fetch(`/api/workspaces/${workspaceId}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to delete workspace."));
  }

  return response.json();
};

const readBoard = async (workspaceId: number): Promise<BoardResponse> => {
  const response = await fetch(`/api/board?workspaceId=${workspaceId}`, {
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to read board.");
  }

  return response.json();
};

const writeBoard = async (
  workspaceId: number,
  board: BoardData,
  version: number
): Promise<BoardResponse> => {
  const response = await fetch("/api/board", {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspaceId, board, version }),
  });

  if (!response.ok) {
    throw new SaveBoardError(response.status, "Failed to save board.");
  }

  return response.json();
};

const sendChatMessage = async (
  workspaceId: number,
  message: string,
  history: ChatHistoryItem[]
): Promise<ChatResponse> => {
  const response = await fetch("/api/chat", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspaceId, message, history }),
  });

  if (!response.ok) {
    throw new Error("Failed to get AI response.");
  }

  return response.json();
};

const createMessageId = (): string =>
  `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const getWorkspaceStorageKey = (userId: number) => `pm-active-workspace-${userId}`;

const readStoredWorkspaceId = (userId: number): number | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(getWorkspaceStorageKey(userId));
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const writeStoredWorkspaceId = (userId: number, workspaceId: number) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(getWorkspaceStorageKey(userId), String(workspaceId));
};

export const AppShell = () => {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginState, setLoginState] = useState<LoginState>(defaultLoginState);
  const [signupState, setSignupState] = useState<SignupState>(defaultSignupState);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [isWorkspaceMutating, setIsWorkspaceMutating] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
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
  const selectedWorkspaceIdRef = useRef<number | null>(null);
  const pendingWorkspaceHydrationRef = useRef<{
    workspaceId: number;
    board: BoardData;
    version: number;
  } | null>(null);

  const applyConfirmedBoard = (
    nextBoard: BoardData,
    nextVersion: number,
    workspaceId: number
  ) => {
    if (selectedWorkspaceIdRef.current !== workspaceId) {
      return;
    }

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
    pendingWorkspaceHydrationRef.current = null;
    setBoard(null);
    setBoardError(null);
    setIsBoardSaving(false);
    setIsBoardLoading(false);
  };

  const resetWorkspaceState = () => {
    setWorkspaces([]);
    setSelectedWorkspaceId(null);
    selectedWorkspaceIdRef.current = null;
    setWorkspaceError(null);
    setIsWorkspaceLoading(false);
    setIsWorkspaceMutating(false);
  };

  const resetChatState = () => {
    setChatMessages([]);
    setPendingChatMessage(null);
    setChatDraft("");
    setChatError(null);
    setIsChatSubmitting(false);
  };

  const loadBoard = async (workspaceId: number) => {
    setBoardError(null);
    setIsBoardLoading(true);

    try {
      const boardResponse = await readBoard(workspaceId);
      applyConfirmedBoard(boardResponse.board, boardResponse.version, workspaceId);
    } catch {
      if (selectedWorkspaceIdRef.current === workspaceId) {
        setBoardError("Unable to load board right now. Please retry.");
      }
    } finally {
      if (selectedWorkspaceIdRef.current === workspaceId) {
        setIsBoardLoading(false);
      }
    }
  };

  const flushBoardSaveQueue = async (workspaceId: number) => {
    if (
      isBoardSaveLoopRunningRef.current ||
      boardVersionRef.current === null ||
      !queuedBoardRef.current
    ) {
      return;
    }

    isBoardSaveLoopRunningRef.current = true;
    if (selectedWorkspaceIdRef.current === workspaceId) {
      setIsBoardSaving(true);
    }

    try {
      while (queuedBoardRef.current && boardVersionRef.current !== null) {
        const boardToSave = cloneBoard(queuedBoardRef.current);
        const versionToSave = boardVersionRef.current;
        queuedBoardRef.current = null;

        try {
          const saved = await writeBoard(workspaceId, boardToSave, versionToSave);
          if (selectedWorkspaceIdRef.current !== workspaceId) {
            return;
          }

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

          if (selectedWorkspaceIdRef.current !== workspaceId) {
            return;
          }

          if (error instanceof SaveBoardError && error.status === 409) {
            try {
              const latestBoard = await readBoard(workspaceId);
              applyConfirmedBoard(latestBoard.board, latestBoard.version, workspaceId);
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
      if (selectedWorkspaceIdRef.current === workspaceId) {
        setIsBoardSaving(false);
        if (queuedBoardRef.current) {
          void flushBoardSaveQueue(workspaceId);
        }
      }
    }
  };

  const loadWorkspaces = async (preferredWorkspaceId?: number | null) => {
    setWorkspaceError(null);
    setIsWorkspaceLoading(true);

    try {
      const response = await readWorkspaces();
      const nextWorkspaces = response.workspaces;
      const storedWorkspaceId = session?.user ? readStoredWorkspaceId(session.user.id) : null;
      const preferredId =
        preferredWorkspaceId ?? selectedWorkspaceIdRef.current ?? storedWorkspaceId ?? null;
      const nextSelectedWorkspaceId = nextWorkspaces.some(
        (workspace) => workspace.id === preferredId
      )
        ? preferredId
        : nextWorkspaces[0]?.id ?? null;

      setWorkspaces(nextWorkspaces);
      setSelectedWorkspaceId(nextSelectedWorkspaceId);
      selectedWorkspaceIdRef.current = nextSelectedWorkspaceId;
    } catch {
      setWorkspaceError("Unable to load workspaces right now. Please retry.");
    } finally {
      setIsWorkspaceLoading(false);
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
          setSession({ authenticated: false, user: null });
          setAuthError("Unable to verify session. Please sign in again.");
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
      resetWorkspaceState();
      resetBoardState();
      resetChatState();
      return;
    }

    void loadWorkspaces();
  }, [session?.authenticated]);

  useEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspaceId;
    if (session?.user && selectedWorkspaceId) {
      writeStoredWorkspaceId(session.user.id, selectedWorkspaceId);
    }
  }, [selectedWorkspaceId, session?.user]);

  useEffect(() => {
    if (!session?.authenticated || selectedWorkspaceId === null) {
      return;
    }

    const pendingWorkspaceHydration = pendingWorkspaceHydrationRef.current;
    if (
      pendingWorkspaceHydration &&
      pendingWorkspaceHydration.workspaceId === selectedWorkspaceId
    ) {
      pendingWorkspaceHydrationRef.current = null;
      applyConfirmedBoard(
        pendingWorkspaceHydration.board,
        pendingWorkspaceHydration.version,
        selectedWorkspaceId
      );
      setBoardError(null);
      setIsBoardLoading(false);
      return;
    }

    resetBoardState();
    resetChatState();
    void loadBoard(selectedWorkspaceId);
  }, [selectedWorkspaceId, session?.authenticated]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError(null);
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
        setAuthError(await readErrorMessage(response, "Sign in failed. Please try again."));
        return;
      }

      const nextSession = (await response.json()) as SessionResponse;
      setSession(nextSession);
      setLoginState(defaultLoginState);
    } catch {
      setAuthError("Sign in failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError(null);

    if (signupState.password !== signupState.confirmPassword) {
      setAuthError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName: signupState.fullName,
          username: signupState.username,
          email: signupState.email,
          password: signupState.password,
        }),
      });

      if (!response.ok) {
        setAuthError(await readErrorMessage(response, "Account creation failed. Please try again."));
        return;
      }

      const nextSession = (await response.json()) as SessionResponse;
      setSession(nextSession);
      setSignupState(defaultSignupState);
    } catch {
      setAuthError("Account creation failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setAuthError(null);
    setIsSubmitting(true);

    try {
      await fetch("/api/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setSession({ authenticated: false, user: null });
      resetWorkspaceState();
      resetBoardState();
      resetChatState();
      setIsSubmitting(false);
    }
  };

  const handleCreateWorkspace = async (name: string) => {
    setWorkspaceError(null);
    setIsWorkspaceMutating(true);

    try {
      const response = await createWorkspaceRequest(name);
      setWorkspaces((current) => [...current, response.workspace]);
      setSelectedWorkspaceId(response.workspace.id);
      selectedWorkspaceIdRef.current = response.workspace.id;
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Unable to create workspace.");
    } finally {
      setIsWorkspaceMutating(false);
    }
  };

  const handleRenameWorkspace = async (workspaceId: number, name: string) => {
    setWorkspaceError(null);
    setIsWorkspaceMutating(true);

    try {
      const response = await renameWorkspaceRequest(workspaceId, name);
      setWorkspaces((current) =>
        current.map((workspace) =>
          workspace.id === workspaceId ? response.workspace : workspace
        )
      );
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Unable to rename workspace.");
    } finally {
      setIsWorkspaceMutating(false);
    }
  };

  const handleDeleteWorkspace = async (workspaceId: number) => {
    setWorkspaceError(null);
    setIsWorkspaceMutating(true);

    try {
      const response = await deleteWorkspaceRequest(workspaceId);
      setWorkspaces(response.workspaces);
      setSelectedWorkspaceId(response.selectedWorkspaceId ?? response.workspaces[0]?.id ?? null);
      selectedWorkspaceIdRef.current =
        response.selectedWorkspaceId ?? response.workspaces[0]?.id ?? null;
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Unable to delete workspace.");
    } finally {
      setIsWorkspaceMutating(false);
    }
  };

  const handleBoardChange = async (nextBoard: BoardData) => {
    if (selectedWorkspaceId === null) {
      return;
    }

    const optimisticBoard = cloneBoard(nextBoard);
    setBoard(optimisticBoard);
    setBoardError(null);
    queuedBoardRef.current = optimisticBoard;
    await flushBoardSaveQueue(selectedWorkspaceId);
  };

  const handleChatSubmit = async () => {
    if (!board || selectedWorkspaceId === null) {
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
      const response = await sendChatMessage(selectedWorkspaceId, trimmedMessage, history);
      if (selectedWorkspaceIdRef.current !== selectedWorkspaceId) {
        return;
      }

      setWorkspaces(response.workspaces);
      if (response.selectedWorkspaceId !== selectedWorkspaceId) {
        pendingWorkspaceHydrationRef.current = {
          workspaceId: response.selectedWorkspaceId,
          board: response.board,
          version: response.version,
        };
        selectedWorkspaceIdRef.current = response.selectedWorkspaceId;
        setSelectedWorkspaceId(response.selectedWorkspaceId);
      } else {
        applyConfirmedBoard(response.board, response.version, selectedWorkspaceId);
      }
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
      if (selectedWorkspaceIdRef.current !== selectedWorkspaceId) {
        return;
      }

      setPendingChatMessage(null);
      setChatDraft(trimmedMessage);
      setChatError("Unable to get AI response right now. Please try again.");
    } finally {
      if (selectedWorkspaceIdRef.current === selectedWorkspaceId) {
        setIsChatSubmitting(false);
      }
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
            Project Management Platform
          </p>
          <h1 className="mt-4 font-display text-4xl font-semibold text-[var(--navy-dark)]">
            Preparing your workspace
          </h1>
          <p className="mt-4 text-sm leading-7 text-[var(--gray-text)]">
            Checking your account session...
          </p>
        </section>
      </main>
    );
  }

  if (session?.authenticated) {
    if (isWorkspaceLoading) {
      return (
        <main className="mx-auto flex min-h-screen max-w-[640px] items-center justify-center px-6">
          <section className="panel-shell rise-in w-full rounded-[34px] px-8 py-12 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
              Workspace Hub
            </p>
            <h1 className="mt-4 font-display text-4xl font-semibold text-[var(--navy-dark)]">
              Loading workspaces...
            </h1>
          </section>
        </main>
      );
    }

    if (!selectedWorkspaceId) {
      return (
        <main className="mx-auto flex min-h-screen max-w-[640px] items-center justify-center px-6">
          <section className="panel-shell rise-in w-full rounded-[34px] px-8 py-12 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
              Workspace Hub
            </p>
            <h1 className="mt-4 font-display text-4xl font-semibold text-[var(--navy-dark)]">
              No workspace selected
            </h1>
            {workspaceError ? (
              <div className="mt-4 space-y-3">
                <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                  {workspaceError}
                </p>
                <button
                  type="button"
                  onClick={() => void loadWorkspaces()}
                  className="rounded-full border border-[rgba(3,33,71,0.12)] bg-white px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--navy-dark)] transition hover:-translate-y-0.5 hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]"
                >
                  Retry
                </button>
              </div>
            ) : null}
          </section>
        </main>
      );
    }

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
            {(boardError || workspaceError) && (
              <div className="mt-4 space-y-3">
                {workspaceError ? (
                  <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                    {workspaceError}
                  </p>
                ) : null}
                {boardError ? (
                  <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                    {boardError}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => void loadBoard(selectedWorkspaceId)}
                  className="rounded-full border border-[rgba(3,33,71,0.12)] bg-white px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--navy-dark)] transition hover:-translate-y-0.5 hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </main>
      );
    }

    return (
      <KanbanBoard
        onLogout={handleLogout}
        username={session.user?.username}
        displayName={session.user?.fullName}
        board={board}
        onBoardChange={(next) => void handleBoardChange(next)}
        boardError={boardError}
        isSavingBoard={isBoardSaving}
        workspaces={workspaces}
        activeWorkspaceId={selectedWorkspaceId}
        onSelectWorkspace={setSelectedWorkspaceId}
        onCreateWorkspace={(name) => void handleCreateWorkspace(name)}
        onRenameWorkspace={(workspaceId, name) => void handleRenameWorkspace(workspaceId, name)}
        onDeleteWorkspace={(workspaceId) => void handleDeleteWorkspace(workspaceId)}
        isManagingWorkspaces={isWorkspaceMutating}
        workspaceError={workspaceError}
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
    <main className="mx-auto flex min-h-screen max-w-[1360px] items-center px-4 py-10 sm:px-6">
      <section className="grid w-full gap-6 lg:grid-cols-[minmax(0,1.12fr)_520px]">
        <div className="panel-shell rise-in soft-grid relative overflow-hidden rounded-[38px] p-8 sm:p-10">
          <div className="relative z-10">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-[rgba(3,33,71,0.08)] bg-[rgba(255,255,255,0.82)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.32em] text-[var(--gray-text)]">
                Project Management Platform
              </span>
              <span className="rounded-full bg-[rgba(236,173,10,0.15)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--navy-dark)]">
                Account Access
              </span>
            </div>

            <h1 className="mt-6 max-w-2xl font-display text-4xl font-semibold leading-tight text-[var(--navy-dark)] sm:text-5xl">
              Professional project delivery, without the demo shortcuts
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-[var(--gray-text)] sm:text-[15px]">
              Create an account, manage separate workspaces, and keep every board backed by the
              server so the product is ready for a more serious deployment path.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <article className="rounded-[26px] border border-[rgba(3,33,71,0.08)] bg-[rgba(255,255,255,0.76)] px-4 py-4 shadow-[0_18px_34px_rgba(3,33,71,0.08)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--gray-text)]">
                  Access
                </p>
                <p className="mt-3 font-display text-2xl font-semibold text-[var(--navy-dark)]">
                  Real signup flow
                </p>
              </article>
              <article className="rounded-[26px] border border-[rgba(3,33,71,0.08)] bg-[rgba(255,255,255,0.76)] px-4 py-4 shadow-[0_18px_34px_rgba(3,33,71,0.08)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--gray-text)]">
                  Structure
                </p>
                <p className="mt-3 font-display text-2xl font-semibold text-[var(--navy-dark)]">
                  Multiple workspaces
                </p>
              </article>
              <article className="rounded-[26px] border border-[rgba(3,33,71,0.08)] bg-[rgba(255,255,255,0.76)] px-4 py-4 shadow-[0_18px_34px_rgba(3,33,71,0.08)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--gray-text)]">
                  Readiness
                </p>
                <p className="mt-3 font-display text-2xl font-semibold text-[var(--navy-dark)]">
                  Backend persistence
                </p>
              </article>
            </div>
          </div>
        </div>

        <section className="panel-shell rise-in rounded-[38px] p-8 [animation-delay:120ms]">
          <div className="flex gap-2 rounded-full bg-[rgba(3,33,71,0.04)] p-1.5">
            <button
              type="button"
              onClick={() => {
                setAuthMode("login");
                setAuthError(null);
              }}
              className={`flex-1 rounded-full px-4 py-3 text-xs font-semibold uppercase tracking-[0.24em] transition ${
                authMode === "login"
                  ? "bg-white text-[var(--navy-dark)] shadow-[0_12px_24px_rgba(3,33,71,0.08)]"
                  : "text-[var(--gray-text)]"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("signup");
                setAuthError(null);
              }}
              className={`flex-1 rounded-full px-4 py-3 text-xs font-semibold uppercase tracking-[0.24em] transition ${
                authMode === "signup"
                  ? "bg-white text-[var(--navy-dark)] shadow-[0_12px_24px_rgba(3,33,71,0.08)]"
                  : "text-[var(--gray-text)]"
              }`}
            >
              Create account
            </button>
          </div>

          {authMode === "login" ? (
            <>
              <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Workspace Access
              </p>
              <h2 className="mt-4 font-display text-3xl font-semibold text-[var(--navy-dark)]">
                Sign in
              </h2>
              <p className="mt-3 text-sm leading-7 text-[var(--gray-text)]">
                Use your account email or username to continue into your active workspace.
              </p>

              <form onSubmit={handleLogin} className="mt-6 space-y-4">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--gray-text)]">
                    Email or username
                  </span>
                  <input
                    value={loginState.identifier}
                    onChange={(event) =>
                      setLoginState((prev) => ({ ...prev, identifier: event.target.value }))
                    }
                    className="mt-3 w-full rounded-[22px] border border-[rgba(3,33,71,0.08)] bg-white px-4 py-3 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[rgba(32,157,215,0.34)]"
                    required
                    autoComplete="username"
                    aria-label="Email or username"
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

                {authError ? (
                  <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600" role="alert">
                    {authError}
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
            </>
          ) : (
            <>
              <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                New Account
              </p>
              <h2 className="mt-4 font-display text-3xl font-semibold text-[var(--navy-dark)]">
                Create account
              </h2>
              <p className="mt-3 text-sm leading-7 text-[var(--gray-text)]">
                Start with a dedicated account and a default workspace that you can expand from.
              </p>

              <form onSubmit={handleSignup} className="mt-6 space-y-4">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--gray-text)]">
                    Full name
                  </span>
                  <input
                    value={signupState.fullName}
                    onChange={(event) =>
                      setSignupState((prev) => ({ ...prev, fullName: event.target.value }))
                    }
                    className="mt-3 w-full rounded-[22px] border border-[rgba(3,33,71,0.08)] bg-white px-4 py-3 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[rgba(32,157,215,0.34)]"
                    required
                    autoComplete="name"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--gray-text)]">
                    Username
                  </span>
                  <input
                    value={signupState.username}
                    onChange={(event) =>
                      setSignupState((prev) => ({ ...prev, username: event.target.value }))
                    }
                    className="mt-3 w-full rounded-[22px] border border-[rgba(3,33,71,0.08)] bg-white px-4 py-3 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[rgba(32,157,215,0.34)]"
                    required
                    autoComplete="username"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--gray-text)]">
                    Email
                  </span>
                  <input
                    type="email"
                    value={signupState.email}
                    onChange={(event) =>
                      setSignupState((prev) => ({ ...prev, email: event.target.value }))
                    }
                    className="mt-3 w-full rounded-[22px] border border-[rgba(3,33,71,0.08)] bg-white px-4 py-3 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[rgba(32,157,215,0.34)]"
                    required
                    autoComplete="email"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--gray-text)]">
                    Password
                  </span>
                  <input
                    type="password"
                    value={signupState.password}
                    onChange={(event) =>
                      setSignupState((prev) => ({ ...prev, password: event.target.value }))
                    }
                    className="mt-3 w-full rounded-[22px] border border-[rgba(3,33,71,0.08)] bg-white px-4 py-3 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[rgba(32,157,215,0.34)]"
                    required
                    autoComplete="new-password"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--gray-text)]">
                    Confirm password
                  </span>
                  <input
                    type="password"
                    value={signupState.confirmPassword}
                    onChange={(event) =>
                      setSignupState((prev) => ({ ...prev, confirmPassword: event.target.value }))
                    }
                    className="mt-3 w-full rounded-[22px] border border-[rgba(3,33,71,0.08)] bg-white px-4 py-3 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[rgba(32,157,215,0.34)]"
                    required
                    autoComplete="new-password"
                  />
                </label>

                {authError ? (
                  <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600" role="alert">
                    {authError}
                  </p>
                ) : null}

                <button
                  type="submit"
                  className="w-full rounded-full bg-[linear-gradient(135deg,_var(--secondary-purple),_#9157a9)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-white transition hover:-translate-y-0.5 hover:shadow-[0_18px_30px_rgba(117,57,145,0.25)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Creating account..." : "Create account"}
                </button>
              </form>
            </>
          )}
        </section>
      </section>
    </main>
  );
};
