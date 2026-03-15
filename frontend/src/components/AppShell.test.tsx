import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AppShell } from "@/components/AppShell";
import { initialData, type BoardData } from "@/lib/kanban";

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type UserRecord = {
  id: number;
  fullName: string;
  username: string;
  email: string;
  password: string;
  workspaces: Array<{ id: number; name: string }>;
};

type SessionState = {
  authenticated: boolean;
  user: {
    id: number;
    fullName: string;
    username: string;
    email: string;
  } | null;
};

const createJsonResponse = (status: number, payload: unknown): MockResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});

const createBoard = (): BoardData => JSON.parse(JSON.stringify(initialData)) as BoardData;

const installApiMock = (options?: { failChat?: boolean }) => {
  let nextUserId = 2;
  let nextWorkspaceId = 2;
  const session: SessionState = { authenticated: false, user: null };
  const users = new Map<number, UserRecord>();
  const boards = new Map<number, { board: BoardData; version: number }>();

  const seedUser: UserRecord = {
    id: 1,
    fullName: "Owner User",
    username: "owner",
    email: "owner@example.com",
    password: "password123",
    workspaces: [{ id: 1, name: "Main workspace" }],
  };

  users.set(seedUser.id, seedUser);
  boards.set(1, { board: createBoard(), version: 1 });

  const currentUser = () => {
    if (!session.user) {
      return null;
    }
    return users.get(session.user.id) ?? null;
  };

  const serializeWorkspaces = (user: UserRecord) =>
    user.workspaces.map((workspace) => ({
      ...workspace,
      createdAt: "2026-03-15T00:00:00Z",
      updatedAt: "2026-03-15T00:00:00Z",
    }));

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    const method = init?.method ?? "GET";

    if (url.includes("/api/session")) {
      return createJsonResponse(200, session);
    }

    if (url.includes("/api/signup")) {
      const body = JSON.parse(String(init?.body)) as {
        fullName: string;
        username: string;
        email: string;
        password: string;
      };
      const duplicateUser = [...users.values()].find(
        (user) =>
          user.username === body.username.toLowerCase() ||
          user.email === body.email.toLowerCase()
      );
      if (duplicateUser) {
        return createJsonResponse(409, { detail: "That username or email is already in use." });
      }

      const userId = nextUserId++;
      const workspaceId = nextWorkspaceId++;
      const user: UserRecord = {
        id: userId,
        fullName: body.fullName,
        username: body.username.toLowerCase(),
        email: body.email.toLowerCase(),
        password: body.password,
        workspaces: [{ id: workspaceId, name: "Main workspace" }],
      };

      users.set(userId, user);
      boards.set(workspaceId, { board: createBoard(), version: 1 });
      session.authenticated = true;
      session.user = {
        id: userId,
        fullName: user.fullName,
        username: user.username,
        email: user.email,
      };
      return createJsonResponse(200, session);
    }

    if (url.includes("/api/login")) {
      const body = JSON.parse(String(init?.body)) as {
        identifier?: string;
        password?: string;
      };
      const identifier = (body.identifier ?? "").toLowerCase();
      const user = [...users.values()].find(
        (item) => item.username === identifier || item.email === identifier
      );
      if (!user || user.password !== body.password) {
        return createJsonResponse(401, { detail: "Invalid credentials" });
      }

      session.authenticated = true;
      session.user = {
        id: user.id,
        fullName: user.fullName,
        username: user.username,
        email: user.email,
      };
      return createJsonResponse(200, session);
    }

    if (url.includes("/api/logout")) {
      session.authenticated = false;
      session.user = null;
      return createJsonResponse(200, { authenticated: false });
    }

    if (!session.authenticated || !session.user) {
      return createJsonResponse(401, { detail: "Unauthorized" });
    }

    const user = currentUser();
    if (!user) {
      return createJsonResponse(401, { detail: "Unauthorized" });
    }

    if (url.includes("/api/workspaces") && method === "GET") {
      return createJsonResponse(200, {
        workspaces: serializeWorkspaces(user),
      });
    }

    if (url.endsWith("/api/workspaces") && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { name: string };
      const workspaceId = nextWorkspaceId++;
      const workspace = { id: workspaceId, name: body.name };
      user.workspaces.push(workspace);
      boards.set(workspaceId, { board: createBoard(), version: 1 });
      return createJsonResponse(200, {
        workspace: {
          ...workspace,
          createdAt: "2026-03-15T00:00:00Z",
          updatedAt: "2026-03-15T00:00:00Z",
        },
      });
    }

    if (url.includes("/api/workspaces/") && method === "PATCH") {
      const workspaceId = Number(url.split("/").pop());
      const body = JSON.parse(String(init?.body)) as { name: string };
      const workspace = user.workspaces.find((item) => item.id === workspaceId);
      if (!workspace) {
        return createJsonResponse(404, { detail: "Workspace was not found." });
      }

      workspace.name = body.name;
      return createJsonResponse(200, {
        workspace: {
          ...workspace,
          createdAt: "2026-03-15T00:00:00Z",
          updatedAt: "2026-03-15T00:00:00Z",
        },
      });
    }

    if (url.includes("/api/workspaces/") && method === "DELETE") {
      const workspaceId = Number(url.split("/").pop());
      user.workspaces = user.workspaces.filter((item) => item.id !== workspaceId);
      boards.delete(workspaceId);
      return createJsonResponse(200, {
        workspaces: serializeWorkspaces(user),
        selectedWorkspaceId: user.workspaces[0]?.id ?? null,
      });
    }

    if (url.includes("/api/board") && method === "GET") {
      const workspaceId = Number(new URL(url, "http://localhost").searchParams.get("workspaceId"));
      const boardState = boards.get(workspaceId);
      if (!boardState) {
        return createJsonResponse(404, { detail: "Workspace was not found." });
      }
      return createJsonResponse(200, boardState);
    }

    if (url.includes("/api/board") && method === "PUT") {
      const body = JSON.parse(String(init?.body)) as {
        workspaceId: number;
        board: BoardData;
        version: number;
      };
      const boardState = boards.get(body.workspaceId);
      if (!boardState) {
        return createJsonResponse(404, { detail: "Workspace was not found." });
      }
      boardState.board = body.board;
      boardState.version += 1;
      return createJsonResponse(200, boardState);
    }

    if (url.includes("/api/chat")) {
      if (options?.failChat) {
        return createJsonResponse(502, { detail: "Upstream failure" });
      }

      const body = JSON.parse(String(init?.body)) as {
        workspaceId: number;
        message: string;
      };
      const boardState = boards.get(body.workspaceId);
      if (!boardState) {
        return createJsonResponse(404, { detail: "Workspace was not found." });
      }

      if (body.message.toLowerCase().includes("weekly report")) {
        boardState.board = createBoard();
        boardState.board.cards["card-ai-1"] = {
          id: "card-ai-1",
          title: "AI weekly report",
          details: "Added by assistant",
        };
        boardState.board.columns[0].cardIds = [
          "card-ai-1",
          ...boardState.board.columns[0].cardIds,
        ];
        boardState.version += 1;

        return createJsonResponse(200, {
          message: "Created task in Backlog",
          operations: [
            {
              type: "create",
              cardId: "card-ai-1",
              title: "AI weekly report",
              details: "Added by assistant",
              columnId: "col-backlog",
              index: 0,
            },
          ],
          workspaces: serializeWorkspaces(user),
          selectedWorkspaceId: body.workspaceId,
          board: boardState.board,
          version: boardState.version,
        });
      }

      if (body.message.toLowerCase().includes("create workspace")) {
        const workspaceId = nextWorkspaceId++;
        const workspace = { id: workspaceId, name: "Operations" };
        user.workspaces.push(workspace);
        boards.set(workspaceId, { board: createBoard(), version: 1 });

        return createJsonResponse(200, {
          message: "Created the Operations workspace.",
          operations: [
            {
              type: "create_workspace",
              workspaceId,
              name: "Operations",
            },
          ],
          workspaces: serializeWorkspaces(user),
          selectedWorkspaceId: body.workspaceId,
          board: boardState.board,
          version: boardState.version,
        });
      }

      if (body.message.toLowerCase().includes("remove review column")) {
        boardState.board = {
          ...boardState.board,
          columns: boardState.board.columns.filter((column) => column.id !== "col-review"),
        };
        boardState.board.columns[2].cardIds = [
          ...boardState.board.columns[2].cardIds,
          "card-6",
        ];
        boardState.version += 1;

        return createJsonResponse(200, {
          message: "Removed Review and moved its cards.",
          operations: [
            {
              type: "delete_column",
              columnId: "col-review",
              targetColumnId: "col-progress",
            },
          ],
          workspaces: serializeWorkspaces(user),
          selectedWorkspaceId: body.workspaceId,
          board: boardState.board,
          version: boardState.version,
        });
      }

      return createJsonResponse(200, {
        message: "No board changes required.",
        operations: [],
        workspaces: serializeWorkspaces(user),
        selectedWorkspaceId: body.workspaceId,
        board: boardState.board,
        version: boardState.version,
      });
    }

    throw new Error(`Unhandled fetch URL in test: ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
};

describe("AppShell", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("shows sign in form when no active session exists", async () => {
    installApiMock();

    render(<AppShell />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument()
    );
    expect(screen.queryByRole("heading", { name: "Kanban Studio" })).not.toBeInTheDocument();
  });

  it("creates an account and shows the board", async () => {
    installApiMock();

    render(<AppShell />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument()
    );

    await userEvent.click(screen.getAllByRole("button", { name: /create account/i })[0]);
    await userEvent.type(screen.getByLabelText(/full name/i), "Jane Owner");
    await userEvent.type(screen.getByLabelText(/^username$/i), "jane");
    await userEvent.type(screen.getByLabelText(/^email$/i), "jane@example.com");
    await userEvent.type(screen.getByLabelText(/^password$/i), "password123");
    await userEvent.type(screen.getByLabelText(/confirm password/i), "password123");
    await userEvent.click(screen.getAllByRole("button", { name: /^create account$/i })[1]);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Kanban Studio" })).toBeInTheDocument()
    );
    expect(screen.getAllByText("Main workspace").length).toBeGreaterThan(0);
  });

  it("signs in with an existing account and logs out", async () => {
    installApiMock();

    render(<AppShell />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument()
    );

    await userEvent.type(screen.getByLabelText(/email or username/i), "owner@example.com");
    await userEvent.type(screen.getByLabelText(/^password$/i), "password123");
    await userEvent.click(screen.getAllByRole("button", { name: /^sign in$/i })[1]);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Kanban Studio" })).toBeInTheDocument()
    );

    await userEvent.click(screen.getByRole("button", { name: /log out/i }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument()
    );
  });

  it("creates and switches between workspaces", async () => {
    installApiMock();

    render(<AppShell />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument()
    );

    await userEvent.type(screen.getByLabelText(/email or username/i), "owner@example.com");
    await userEvent.type(screen.getByLabelText(/^password$/i), "password123");
    await userEvent.click(screen.getAllByRole("button", { name: /^sign in$/i })[1]);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Kanban Studio" })).toBeInTheDocument()
    );

    await userEvent.click(screen.getByRole("button", { name: /create workspace/i }));
    await userEvent.type(screen.getByLabelText(/workspace name/i), "Operations");
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Operations" })).toBeVisible());
    await userEvent.click(screen.getByRole("button", { name: "Operations" }));

    const workspacePanel = screen.getByText("Workspace").closest("div");
    expect(workspacePanel).not.toBeNull();
    expect(screen.getAllByText("Operations").length).toBeGreaterThan(0);
  });

  it("sends chat request and applies returned board updates", async () => {
    installApiMock();

    render(<AppShell />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument()
    );

    await userEvent.type(screen.getByLabelText(/email or username/i), "owner@example.com");
    await userEvent.type(screen.getByLabelText(/^password$/i), "password123");
    await userEvent.click(screen.getAllByRole("button", { name: /^sign in$/i })[1]);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Kanban Studio" })).toBeInTheDocument()
    );

    await userEvent.click(screen.getByRole("button", { name: /open board assistant/i }));
    await userEvent.type(screen.getByLabelText(/ai message/i), "Create weekly report task");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByText("Created task in Backlog")).toBeInTheDocument()
    );
    expect(screen.getByText("AI weekly report")).toBeInTheDocument();
  });

  it("applies AI-created workspace updates to the workspace list", async () => {
    installApiMock();

    render(<AppShell />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument()
    );

    await userEvent.type(screen.getByLabelText(/email or username/i), "owner@example.com");
    await userEvent.type(screen.getByLabelText(/^password$/i), "password123");
    await userEvent.click(screen.getAllByRole("button", { name: /^sign in$/i })[1]);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Kanban Studio" })).toBeInTheDocument()
    );

    await userEvent.click(screen.getByRole("button", { name: /open board assistant/i }));
    await userEvent.type(screen.getByLabelText(/ai message/i), "Create workspace for operations");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByText("Created the Operations workspace.")).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Operations" })).toBeVisible();
  });

  it("applies AI column deletions to the current board", async () => {
    installApiMock();

    render(<AppShell />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument()
    );

    await userEvent.type(screen.getByLabelText(/email or username/i), "owner@example.com");
    await userEvent.type(screen.getByLabelText(/^password$/i), "password123");
    await userEvent.click(screen.getAllByRole("button", { name: /^sign in$/i })[1]);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Kanban Studio" })).toBeInTheDocument()
    );

    expect(screen.getAllByText("Review").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: /open board assistant/i }));
    await userEvent.type(screen.getByLabelText(/ai message/i), "Remove Review column");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByText("Removed Review and moved its cards.")).toBeInTheDocument()
    );
    expect(screen.queryAllByText("Review")).toHaveLength(0);
  });

  it("shows chat error when chat API fails", async () => {
    installApiMock({ failChat: true });

    render(<AppShell />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument()
    );

    await userEvent.type(screen.getByLabelText(/email or username/i), "owner@example.com");
    await userEvent.type(screen.getByLabelText(/^password$/i), "password123");
    await userEvent.click(screen.getAllByRole("button", { name: /^sign in$/i })[1]);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Kanban Studio" })).toBeInTheDocument()
    );

    await userEvent.click(screen.getByRole("button", { name: /open board assistant/i }));
    await userEvent.type(screen.getByLabelText(/ai message/i), "Move card-1 to review");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(
        screen.getByText("Unable to get AI response right now. Please try again.")
      ).toBeInTheDocument()
    );
  });
});
