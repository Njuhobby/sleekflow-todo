import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * THE demo script (T-5.6) — the exact flow presented in the interview:
 * create two todos → add a dependency → starting the blocked task is
 * rejected with a visible reason → complete the dependency → start →
 * complete → a recurring todo's completion spawns the next occurrence →
 * delete/undo and the trash view.
 */

const run = Date.now().toString(36);
const DEP = `Design draft ${run}`;
const BLOCKED = `Implement UI ${run}`;
const WEEKLY = `Weekly report ${run}`;

// T-7.1 forced login: register a fresh user via the API before each test —
// the cookie lands in the browser context's jar.
test.beforeEach(async ({ page }) => {
  const res = await page.request.post("/api/auth/register", {
    data: {
      email: `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: "E2E Tester",
      password: "password123",
    },
  });
  expect(res.status()).toBe(201);
});

async function quickAdd(page: Page, name: string) {
  const input = page.getByLabel("Quick add todo");
  await input.fill(name);
  await input.press("Enter");
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

function rowFor(page: Page, name: string) {
  return page.locator("tr", { hasText: name });
}

async function rowAction(page: Page, name: string, action: string) {
  const row = rowFor(page, name);
  await row.hover();
  await row.getByLabel(`Actions for ${name}`).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

/** Close the detail panel deterministically and wait for the overlay to go. */
async function closePanel(page: Page) {
  await page.locator(".panel").getByLabel("Close").click();
  await expect(page.locator(".panel-overlay")).toHaveCount(0);
}

test("the interview demo script", async ({ page }) => {
  await page.goto("/");

  // ── create two todos via quick-add ─────────────────────────────────
  await quickAdd(page, DEP);
  await quickAdd(page, BLOCKED);

  // ── declare the dependency in the detail panel (draft → atomic save) ─
  await page.getByText(BLOCKED, { exact: true }).click();
  await page.getByLabel("Search dependencies").fill(DEP.slice(0, 20));
  await page.locator(".picker-item", { hasText: DEP }).click();
  await expect(page.locator(".dep-chip", { hasText: DEP })).toBeVisible(); // draft
  await page.getByRole("button", { name: "Save changes" }).click();
  // the save bumps the version and the panel remounts on the committed state
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await expect(page.locator(".dep-chip", { hasText: DEP })).toBeVisible();
  await closePanel(page);

  // the row now wears the lock
  await expect(rowFor(page, BLOCKED).getByTestId("blocked-badge")).toBeVisible();

  // ── starting the blocked task fails with a NAMED reason ────────────
  await rowAction(page, BLOCKED, "Start");
  await expect(page.locator(".toast-error")).toContainText(`Blocked by incomplete dependency: "${DEP}"`);

  // ── complete the dependency, then the flow unblocks ────────────────
  await rowAction(page, DEP, "Complete");
  await expect(rowFor(page, DEP).getByText("Completed")).toBeVisible();

  await rowAction(page, BLOCKED, "Start");
  await expect(rowFor(page, BLOCKED).getByText("In progress")).toBeVisible();
  await rowAction(page, BLOCKED, "Complete");
  await expect(rowFor(page, BLOCKED).getByText("Completed")).toBeVisible();

  // ── recurring: completing spawns the next occurrence ───────────────
  await page.getByRole("button", { name: "+ New" }).click();
  await page.getByLabel("Name").fill(WEEKLY);
  await page.getByLabel("Recurrence").selectOption("weekly");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  // the detail panel opens for the created todo — wait for it, then close
  await expect(page.locator(".panel").getByLabel("Name")).toHaveValue(WEEKLY);
  await closePanel(page);

  await rowAction(page, WEEKLY, "Complete");
  await expect(page.locator(".toast").last()).toContainText("next occurrence created");
  // two rows now: the completed one and the spawned not-started one
  await expect(rowFor(page, WEEKLY)).toHaveCount(2);
  await expect(
    rowFor(page, WEEKLY).filter({ hasText: "Not started" })
  ).toHaveCount(1);

  // the spawn is visible in the activity trail
  await rowFor(page, WEEKLY).filter({ hasText: "Not started" }).getByText(WEEKLY).click();
  await expect(page.locator(".timeline")).toContainText("Created by recurrence");
  await closePanel(page);

  // ── soft delete → undo toast → trash view ──────────────────────────
  await rowAction(page, DEP, "Delete");
  await expect(page.locator(".toast").last()).toContainText(`Deleted "${DEP}"`);
  await expect(rowFor(page, DEP)).toHaveCount(0);

  await page.getByRole("link", { name: "Trash" }).click();
  await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
  const trashRow = rowFor(page, DEP);
  await expect(trashRow).toHaveCount(1);
  await trashRow.hover();
  await trashRow.getByRole("button", { name: "Restore" }).click();
  await expect(rowFor(page, DEP)).toHaveCount(0);

  await page.getByRole("link", { name: "← Back" }).click();
  await expect(rowFor(page, DEP)).toHaveCount(1); // back with its status intact
  await expect(rowFor(page, DEP).getByText("Completed")).toBeVisible();
});

test("the login gate: anonymous users see the form, registering enters the app", async ({
  page,
}) => {
  await page.context().clearCookies(); // drop the beforeEach session
  await page.goto("/");

  // gated: the form, not the list
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  await expect(page.getByLabel("Quick add todo")).toHaveCount(0);

  // register through the UI
  await page.getByRole("button", { name: "No account? Register" }).click();
  await page.getByLabel("Email").fill(`ui-${Date.now()}@example.com`);
  await page.getByLabel("Name").fill("Form Tester");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();

  // in: the list renders and the header shows who we are
  await expect(page.getByLabel("Quick add todo")).toBeVisible();
  await expect(page.locator(".user-chip")).toContainText("Form Tester");

  // log out → back to the gate
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});

test("calendar view renders the month grid and round-trips to the list", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Calendar view" }).click();

  const calendar = page.getByTestId("calendar");
  await expect(calendar).toBeVisible();
  await expect(calendar.getByText("Mon", { exact: true })).toBeVisible();
  // today's cell is marked
  await expect(page.locator(".calendar-today")).toHaveCount(1);

  await page.getByRole("button", { name: "List view" }).click();
  await expect(page.getByTestId("calendar")).toHaveCount(0);
  await expect(page.getByLabel("Quick add todo")).toBeVisible();
});
