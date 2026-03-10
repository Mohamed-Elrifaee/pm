import { expect, test, type Page } from "@playwright/test";

type SessionState = {
  authenticated: boolean;
  username: string | null;
};

const installAuthMocks = async (page: Page) => {
  const state: SessionState = { authenticated: false, username: null };

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
