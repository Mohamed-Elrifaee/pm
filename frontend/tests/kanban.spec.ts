import { expect, test, type Page } from "@playwright/test";

type SessionState = {
  authenticated: boolean;
  username: string | null;
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

const installAuthMocks = async (page: Page, options: MockOptions = {}) => {
  const state: SessionState = { authenticated: false, username: null };
  let board: BoardData = createInitialBoard();
  let version = 1;

  await page.route("**/api/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(state),
    });
  });

  await page.route("**/api/login", async (route) => {
    const body = route.request().postDataJSON() as {
      username?: string;
      password?: string;
    };

    if (body.username === "user" && body.password === "password") {
      state.authenticated = true;
      state.username = "user";

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(state),
      });
      return;
    }

    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Invalid credentials" }),
    });
  });

  await page.route("**/api/logout", async (route) => {
    state.authenticated = false;
    state.username = null;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authenticated: false }),
    });
  });

  await page.route("**/api/board", async (route) => {
    if (!state.authenticated) {
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
        body: JSON.stringify({ board, version }),
      });
      return;
    }

    if (route.request().method() === "PUT") {
      board = route.request().postDataJSON() as BoardData;
      version += 1;

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ board, version }),
      });
      return;
    }

    await route.fulfill({
      status: 405,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Method not allowed" }),
    });
  });

  await page.route("**/api/chat", async (route) => {
    if (!state.authenticated) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Unauthorized" }),
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

    const payload = route.request().postDataJSON() as {
      message?: string;
    };

    if (route.request().method() !== "POST") {
      await route.fulfill({
        status: 405,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Method not allowed" }),
      });
      return;
    }

    const normalizedMessage = (payload.message ?? "").toLowerCase();
    if (normalizedMessage.includes("weekly report")) {
      const cardId = `card-ai-${version + 1}`;
      board = {
        ...board,
        columns: board.columns.map((column) =>
          column.id === "col-backlog"
            ? { ...column, cardIds: [cardId, ...column.cardIds] }
            : column
        ),
        cards: {
          ...board.cards,
          [cardId]: {
            id: cardId,
            title: "AI weekly report",
            details: "Added by chat assistant.",
          },
        },
      };
      version += 1;

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
          board,
          version,
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
        board,
        version,
      }),
    });
  });
};

const login = async (page: Page) => {
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
};

test("requires login before showing the board", async ({ page }) => {
  await installAuthMocks(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).not.toBeVisible();
});

test("adds a card to a column", async ({ page }) => {
  await installAuthMocks(page);
  await page.goto("/");
  await login(page);

  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill("Playwright card");
  await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn.getByText("Playwright card")).toBeVisible();
});

test("moves a card between columns", async ({ page }) => {
  await installAuthMocks(page);
  await page.goto("/");
  await login(page);

  const card = page.getByTestId("card-card-1");
  const targetColumn = page.getByTestId("column-col-review");
  const cardBox = await card.boundingBox();
  const columnBox = await targetColumn.boundingBox();
  if (!cardBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }

  await page.mouse.move(
    cardBox.x + cardBox.width / 2,
    cardBox.y + cardBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    columnBox.x + columnBox.width / 2,
    columnBox.y + 120,
    { steps: 12 }
  );
  await page.mouse.up();
  await expect(targetColumn.getByTestId("card-card-1")).toBeVisible();
});

test("moves a card into an empty column", async ({ page }) => {
  await installAuthMocks(page);
  await page.goto("/");
  await login(page);

  await page.locator('button[aria-label="Delete QA micro-interactions"]').click();
  const reviewColumn = page.getByTestId("column-col-review");
  await expect(reviewColumn.getByText("Drop a card here")).toBeVisible();

  const card = page.getByTestId("card-card-1");
  const cardBox = await card.boundingBox();
  const reviewBox = await reviewColumn.boundingBox();
  if (!cardBox || !reviewBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }

  await page.mouse.move(
    cardBox.x + cardBox.width / 2,
    cardBox.y + cardBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    reviewBox.x + reviewBox.width / 2,
    reviewBox.y + reviewBox.height / 2,
    { steps: 12 }
  );
  await page.mouse.up();

  await expect(reviewColumn.getByTestId("card-card-1")).toBeVisible();
});

test("logs out and returns to sign in", async ({ page }) => {
  await installAuthMocks(page);
  await page.goto("/");
  await login(page);

  await page.getByRole("button", { name: /log out/i }).click();
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
});

test("keeps board changes after logout and login for the same user", async ({ page }) => {
  await installAuthMocks(page);
  await page.goto("/");
  await login(page);

  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill("Persistent card");
  await firstColumn.getByPlaceholder("Details").fill("Should remain after re-login.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn.getByText("Persistent card")).toBeVisible();

  await page.getByRole("button", { name: /log out/i }).click();
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();

  await login(page);
  await expect(page.getByText("Persistent card")).toBeVisible();
});

test("keeps board changes after page reload", async ({ page }) => {
  await installAuthMocks(page);
  await page.goto("/");
  await login(page);

  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill("Reload card");
  await firstColumn.getByPlaceholder("Details").fill("Should remain after reload.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn.getByText("Reload card")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Reload card")).toBeVisible();
});

test("applies AI chat operations and updates the board automatically", async ({ page }) => {
  await installAuthMocks(page);
  await page.goto("/");
  await login(page);

  await page.getByLabel("AI message").fill("Create a weekly report card in backlog");
  await page.getByRole("button", { name: /^send$/i }).click();

  await expect(page.getByText("Created task in Backlog")).toBeVisible();
  await expect(page.getByText("AI weekly report")).toBeVisible();
});

test("shows chat error and keeps board usable when AI call fails", async ({ page }) => {
  await installAuthMocks(page, { failChat: true });
  await page.goto("/");
  await login(page);

  await page.getByLabel("AI message").fill("Create a weekly report card in backlog");
  await page.getByRole("button", { name: /^send$/i }).click();

  await expect(
    page.getByText("Unable to get AI response right now. Please try again.")
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
});
