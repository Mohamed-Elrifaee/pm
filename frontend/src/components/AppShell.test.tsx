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
});
