import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "@/components/AppShell";
import { initialData } from "@/lib/kanban";

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

const createJsonResponse = (status: number, payload: unknown): MockResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});

const createBoardPayload = () => ({
  board: JSON.parse(JSON.stringify(initialData)),
  version: 1,
});

const createBoardPayloadWithAICard = () => {
  const board = JSON.parse(JSON.stringify(initialData));
  board.cards["card-ai-1"] = {
    id: "card-ai-1",
    title: "AI weekly report",
    details: "Added by assistant",
  };
  board.columns[0].cardIds = ["card-ai-1", ...board.columns[0].cardIds];

  return {
    board,
    version: 2,
  };
};

describe("AppShell", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows login form when no active session exists", async () => {
    const fetchMock = vi.fn(async () =>
      createJsonResponse(200, { authenticated: false, username: null })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AppShell />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument()
    );
    expect(screen.queryByRole("heading", { name: "Kanban Studio" })).not.toBeInTheDocument();
  });

  it("signs in with valid credentials and shows the board", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      if (url.includes("/api/session")) {
        return createJsonResponse(200, { authenticated: false, username: null });
      }

      if (url.includes("/api/login")) {
        return createJsonResponse(200, { authenticated: true, username: "user" });
      }

      if (url.includes("/api/board")) {
        return createJsonResponse(200, createBoardPayload());
      }

      throw new Error(`Unhandled fetch URL in test: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<AppShell />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument()
    );

    await userEvent.type(screen.getByLabelText(/username/i), "user");
    await userEvent.type(screen.getByLabelText(/password/i), "password");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Kanban Studio" })).toBeInTheDocument()
    );
  });

  it("logs out and returns to login screen", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      if (url.includes("/api/session")) {
        return createJsonResponse(200, { authenticated: true, username: "user" });
      }

      if (url.includes("/api/board")) {
        return createJsonResponse(200, createBoardPayload());
      }

      if (url.includes("/api/logout")) {
        return createJsonResponse(200, { authenticated: false });
      }

      throw new Error(`Unhandled fetch URL in test: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<AppShell />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Kanban Studio" })).toBeInTheDocument()
    );

    await userEvent.click(screen.getByRole("button", { name: /log out/i }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument()
    );
  });

  it("sends chat request and applies returned board updates", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      if (url.includes("/api/session")) {
        return createJsonResponse(200, { authenticated: true, username: "user" });
      }

      if (url.includes("/api/board")) {
        return createJsonResponse(200, createBoardPayload());
      }

      if (url.includes("/api/chat")) {
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
          ...createBoardPayloadWithAICard(),
        });
      }

      throw new Error(`Unhandled fetch URL in test: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<AppShell />);

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

  it("shows chat error when chat API fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      if (url.includes("/api/session")) {
        return createJsonResponse(200, { authenticated: true, username: "user" });
      }

      if (url.includes("/api/board")) {
        return createJsonResponse(200, createBoardPayload());
      }

      if (url.includes("/api/chat")) {
        return createJsonResponse(502, { detail: "Upstream failure" });
      }

      throw new Error(`Unhandled fetch URL in test: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<AppShell />);

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

  it("keeps the board assistant hidden until launched", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      if (url.includes("/api/session")) {
        return createJsonResponse(200, { authenticated: true, username: "user" });
      }

      if (url.includes("/api/board")) {
        return createJsonResponse(200, createBoardPayload());
      }

      throw new Error(`Unhandled fetch URL in test: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<AppShell />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Kanban Studio" })).toBeInTheDocument()
    );

    expect(screen.queryByLabelText(/ai message/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /open board assistant/i }));

    expect(screen.getByLabelText(/ai message/i)).toBeInTheDocument();
  });
});
