import { expect, test, type Page } from "@playwright/test";

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

type Card = {
  id: string;
  title: string;
  details: string;
};

type Column = {
  id: string;
  title: string;
  cardIds: string[];
};

type BoardData = {
  columns: Column[];
  cards: Record<string, Card>;
};

const createInitialBoard = (): BoardData => ({
  columns: [
    { id: "col-backlog", title: "Backlog", cardIds: ["card-1", "card-2"] },
    { id: "col-discovery", title: "Discovery", cardIds: ["card-3"] },
    { id: "col-progress", title: "In Progress", cardIds: ["card-4", "card-5"] },
    { id: "col-review", title: "Review", cardIds: ["card-6"] },
    { id: "col-done", title: "Done", cardIds: ["card-7", "card-8"] },
  ],
  cards: {
    "card-1": {
      id: "card-1",
      title: "Align roadmap themes",
      details: "Draft quarterly themes with impact statements and metrics.",
    },
    "card-2": {
      id: "card-2",
      title: "Gather customer signals",
      details: "Review support tags, sales notes, and churn feedback.",
    },
    "card-3": {
      id: "card-3",
      title: "Prototype analytics view",
      details: "Sketch initial dashboard layout and key drill-downs.",
    },
    "card-4": {
      id: "card-4",
      title: "Refine status language",
      details: "Standardize column labels and tone across the board.",
    },
    "card-5": {
      id: "card-5",
      title: "Design card layout",
      details: "Add hierarchy and spacing for scanning dense lists.",
    },
    "card-6": {
      id: "card-6",
      title: "QA micro-interactions",
      details: "Verify hover, focus, and loading states.",
    },
    "card-7": {
      id: "card-7",
      title: "Ship marketing page",
      details: "Final copy approved and asset pack delivered.",
    },
    "card-8": {
      id: "card-8",
      title: "Close onboarding sprint",
      details: "Document release notes and share internally.",
    },
  },
});

type MockOptions = {
  failChat?: boolean;
};

const installApiMocks = async (page: Page, options: MockOptions = {}) => {
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
  users.set(1, seedUser);
  boards.set(1, { board: createInitialBoard(), version: 1 });

  const currentUser = () => {
    if (!session.user) {
      return null;
    }
    return users.get(session.user.id) ?? null;
  };

  await page.route("**/api/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(session),
    });
  });

  await page.route("**/api/signup", async (route) => {
    const body = route.request().postDataJSON() as {
      fullName: string;
      username: string;
      email: string;
      password: string;
    };
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
    boards.set(workspaceId, { board: createInitialBoard(), version: 1 });
    session.authenticated = true;
    session.user = {
      id: userId,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
    };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(session),
    });
  });

  await page.route("**/api/login", async (route) => {
    const body = route.request().postDataJSON() as {
      identifier?: string;
      password?: string;
    };
    const identifier = (body.identifier ?? "").toLowerCase();
    const user = [...users.values()].find(
      (item) => item.username === identifier || item.email === identifier
    );
    if (!user || user.password !== body.password) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Invalid credentials" }),
      });
      return;
    }

    session.authenticated = true;
    session.user = {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
    };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(session),
    });
  });

  await page.route("**/api/logout", async (route) => {
    session.authenticated = false;
    session.user = null;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authenticated: false }),
    });
  });

  await page.route("**/api/workspaces", async (route) => {
    const user = currentUser();
    if (!user) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Unauthorized" }),
      });
      return;
    }

    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          workspaces: user.workspaces.map((workspace) => ({
            ...workspace,
            createdAt: "2026-03-15T00:00:00Z",
            updatedAt: "2026-03-15T00:00:00Z",
          })),
        }),
      });
      return;
    }

    const body = route.request().postDataJSON() as { name: string };
    const workspaceId = nextWorkspaceId++;
    const workspace = { id: workspaceId, name: body.name };
    user.workspaces.push(workspace);
    boards.set(workspaceId, { board: createInitialBoard(), version: 1 });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspace: {
          ...workspace,
          createdAt: "2026-03-15T00:00:00Z",
          updatedAt: "2026-03-15T00:00:00Z",
        },
      }),
    });
  });

  await page.route("**/api/workspaces/*", async (route) => {
    const user = currentUser();
    if (!user) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Unauthorized" }),
      });
      return;
    }

    const workspaceId = Number(route.request().url().split("/").pop());
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { name: string };
      const workspace = user.workspaces.find((item) => item.id === workspaceId);
      if (!workspace) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Workspace was not found." }),
        });
        return;
      }
      workspace.name = body.name;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          workspace: {
            ...workspace,
            createdAt: "2026-03-15T00:00:00Z",
            updatedAt: "2026-03-15T00:00:00Z",
          },
        }),
      });
      return;
    }

    user.workspaces = user.workspaces.filter((item) => item.id !== workspaceId);
    boards.delete(workspaceId);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspaces: user.workspaces.map((workspace) => ({
          ...workspace,
          createdAt: "2026-03-15T00:00:00Z",
          updatedAt: "2026-03-15T00:00:00Z",
        })),
        selectedWorkspaceId: user.workspaces[0]?.id ?? null,
      }),
    });
  });

  await page.route("**/api/board?*", async (route) => {
    const workspaceId = Number(new URL(route.request().url()).searchParams.get("workspaceId"));
    const boardState = boards.get(workspaceId);
    if (!boardState) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Workspace was not found." }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(boardState),
    });
  });

  await page.route("**/api/board", async (route) => {
    const body = route.request().postDataJSON() as {
      workspaceId: number;
      board: BoardData;
    };
    const boardState = boards.get(body.workspaceId);
    if (!boardState) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Workspace was not found." }),
      });
      return;
    }

    boardState.board = body.board;
    boardState.version += 1;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(boardState),
    });
  });

  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON() as {
      workspaceId: number;
      message?: string;
    };
    const boardState = boards.get(body.workspaceId);
    if (!boardState) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Workspace was not found." }),
      });
      return;
    }

    if (options.failChat) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Upstream failure" }),
      });
      return;
    }

    if ((body.message ?? "").toLowerCase().includes("weekly report")) {
      const cardId = `card-ai-${body.workspaceId}`;
      boardState.board.cards[cardId] = {
        id: cardId,
        title: "AI weekly report",
        details: "Added by chat assistant.",
      };
      boardState.board.columns[0].cardIds = [cardId, ...boardState.board.columns[0].cardIds];
      boardState.version += 1;

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Created task in Backlog",
          operations: [
            {
              type: "create",
              cardId,
              title: "AI weekly report",
              details: "Added by chat assistant.",
              columnId: "col-backlog",
              index: 0,
            },
          ],
          board: boardState.board,
          version: boardState.version,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: "No board changes required.",
        operations: [],
        board: boardState.board,
        version: boardState.version,
      }),
    });
  });
};

const login = async (page: Page) => {
  await page.getByLabel("Email or username").fill("owner@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.locator("form").getByRole("button", { name: /^sign in$/i }).click();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
};

test("requires sign in before showing the board", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).not.toBeVisible();
});

test("creates an account and lands on the board", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");

  await page.getByRole("button", { name: /create account/i }).click();
  await page.getByLabel("Full name").fill("Jane Owner");
  await page.getByLabel("Username").fill("jane");
  await page.getByLabel("Email").fill("jane@example.com");
  await page.getByLabel(/^Password$/).fill("password123");
  await page.getByLabel("Confirm password").fill("password123");
  await page.locator("form").getByRole("button", { name: /^create account$/i }).click();

  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Main workspace" })).toBeVisible();
});

test("adds a card to a column", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await login(page);

  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill("Playwright card");
  await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn).toContainText("Playwright card");
});

test("creates and switches workspaces", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await login(page);

  await page.getByRole("button", { name: /create workspace/i }).click();
  await page.getByLabel("Workspace name").fill("Operations");
  await page.getByRole("button", { name: /^create$/i }).click();

  await expect(page.getByRole("button", { name: "Operations" })).toBeVisible();
  await page.getByRole("button", { name: "Operations" }).click();
  await expect(page.getByText("Operations").first()).toBeVisible();
});

test("logs out and returns to sign in", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await login(page);

  await page.getByRole("button", { name: /log out/i }).click();
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
});

test("keeps board changes after page reload", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await login(page);

  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill("Reload card");
  await firstColumn.getByPlaceholder("Details").fill("Should remain after reload.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn).toContainText("Reload card");

  await page.reload();
  await expect(page.getByTestId("column-col-backlog")).toContainText("Reload card");
});

test("applies AI chat operations and updates the board automatically", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await login(page);

  await page.getByRole("button", { name: /open board assistant/i }).click();
  await page.getByLabel("AI message").fill("Create a weekly report card in backlog");
  await page.getByRole("button", { name: /^send$/i }).click();

  await expect(page.getByText("Created task in Backlog")).toBeVisible();
  await expect(page.getByTestId("column-col-backlog")).toContainText("AI weekly report");
});

test("shows chat error and keeps board usable when AI call fails", async ({ page }) => {
  await installApiMocks(page, { failChat: true });
  await page.goto("/");
  await login(page);

  await page.getByRole("button", { name: /open board assistant/i }).click();
  await page.getByLabel("AI message").fill("Create a weekly report card in backlog");
  await page.getByRole("button", { name: /^send$/i }).click();

  await expect(
    page.getByText("Unable to get AI response right now. Please try again.")
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
});
