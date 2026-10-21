import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "../support/fixtures";
import { connectSeedClient } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";
import {
  openMobileAgentSidebar,
  expectMobileAgentSidebarVisible,
} from "../support/helpers/sidebar";
import {
  createMockIdleAgent,
  openSessions,
  resetSeededPageState,
} from "../support/helpers/archive-tab";

/**
 * Every seeded title opens with the same nonce, so a query of "<nonce> term"
 * can only reach this spec's sessions. The daemon is shared with the rest of
 * the browser suite and its history is whatever those specs left behind.
 */
const NONCE = `hsq${randomUUID().replaceAll("-", "").slice(0, 8)}`;

const TITLES = {
  billing: `${NONCE} main Add Stripe billing`,
  unbilled: `${NONCE} main Unbilled usage report`,
  terminal: `${NONCE} main Terminal resize fix`,
} as const;

function trackHistoryRequests(page: Page) {
  const requests: { search?: string; searchOptions?: { regex?: boolean } }[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") return;
      const frame = JSON.parse(payload);
      if (frame.type === "fetch_agent_history_request") requests.push(frame);
    }),
  );
  return requests;
}

async function search(page: Page, query: string): Promise<void> {
  await page.getByTestId("sessions-search-input").fill(query);
}

function rowTitles(page: Page) {
  return page.getByRole("button").and(page.getByTestId(/^agent-row-/));
}

async function expectVisibleTitles(page: Page, titles: string[]): Promise<void> {
  const rows = rowTitles(page).filter({ hasText: NONCE });
  await expect(rows).toHaveCount(titles.length, { timeout: 30_000 });
  for (const [index, title] of titles.entries()) {
    await expect(rows.nth(index)).toContainText(title, { timeout: 30_000 });
  }
}

async function verifyChronologicalFiltering(page: Page): Promise<void> {
  await test.step("narrows history while preserving chronological grouping", async () => {
    await expectVisibleTitles(page, [TITLES.unbilled, TITLES.billing, TITLES.terminal]);
    await expect(page.getByText("Today", { exact: true })).toHaveCount(1, {
      timeout: 30_000,
    });

    await search(page, `${NONCE} billing`);
    await expectVisibleTitles(page, [TITLES.billing]);
    await expect(page.getByText("Today", { exact: true })).toHaveCount(1, {
      timeout: 30_000,
    });

    await page.getByTestId("sessions-search-clear").click();
    await expect(page.getByTestId("sessions-search-input")).toHaveValue("");
    await expectVisibleTitles(page, [TITLES.unbilled, TITLES.billing, TITLES.terminal]);
    await expect(page.getByText("Today", { exact: true })).toHaveCount(1, {
      timeout: 30_000,
    });
  });
}

async function verifyRecencyBeforeMatchStrength(page: Page): Promise<void> {
  await test.step("keeps newer partial matches before older stronger matches", async () => {
    await search(page, `${NONCE} bill`);
    await expectVisibleTitles(page, [TITLES.unbilled, TITLES.billing]);
  });
}

async function verifyExactAndTypoHighlights(page: Page): Promise<void> {
  await test.step("highlights exact and typo-resolved matches", async () => {
    await search(page, `${NONCE} billing`);
    const row = rowTitles(page).filter({ hasText: NONCE }).first();
    await expect(row.getByText("billing", { exact: true })).toBeVisible({ timeout: 30_000 });

    await search(page, `${NONCE} bulling`);
    await expectVisibleTitles(page, [TITLES.billing]);
    const typoRow = rowTitles(page).filter({ hasText: NONCE }).first();
    await expect(typoRow.getByText("billing", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  });
}

async function verifyAllSearchFieldHighlights(page: Page, repoPath: string): Promise<void> {
  await test.step("shows the repository folder and highlights each field independently", async () => {
    await search(page, `${NONCE} main`);
    await expectVisibleTitles(page, [TITLES.unbilled, TITLES.billing, TITLES.terminal]);
    const row = rowTitles(page).filter({ hasText: NONCE }).first();
    await expect(row.getByTestId(/^agent-row-workspace-(?!name-)/)).toHaveText(
      path.basename(repoPath),
    );
    for (const field of ["workspace", "title", "project", "branch"]) {
      await expect(
        row.getByTestId(new RegExp(`^agent-row-${field}-(?!name-)`)).getByText(/^main$/i),
      ).toBeVisible();
    }
    await expect(page.getByText("Yesterday", { exact: true })).toHaveCount(0);
  });
}

async function verifyEmptySearchAndRecovery(page: Page): Promise<void> {
  await test.step("distinguishes no matches from empty history", async () => {
    await search(page, `${NONCE} kubernetes`);
    await expect(page.getByTestId("sessions-empty")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("No sessions match")).toBeVisible({ timeout: 30_000 });

    await page
      .getByTestId("sessions-empty")
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await expect(page.getByTestId("sessions-search-input")).toHaveValue("");
    await expectVisibleTitles(page, [TITLES.unbilled, TITLES.billing, TITLES.terminal]);
  });
}

test.describe("History search", () => {
  let client: Awaited<ReturnType<typeof connectSeedClient>>;
  let tempRepo: { path: string; cleanup: () => Promise<void> };
  let projectId: string;
  let workspaceId: string;

  test.describe.configure({ timeout: 300_000 });

  test.beforeAll(async () => {
    tempRepo = await createTempGitRepo("main-sessions-search-");
    client = await connectSeedClient();
    const created = await client.createWorkspace({
      source: { kind: "directory", path: tempRepo.path },
      title: "Main history",
    });
    if (!created.workspace) {
      throw new Error(created.error ?? `Failed to create workspace ${tempRepo.path}`);
    }
    projectId = created.workspace.projectId;
    workspaceId = created.workspace.id;

    for (const title of [TITLES.terminal, TITLES.billing, TITLES.unbilled]) {
      await createMockIdleAgent(client, { cwd: tempRepo.path, workspaceId, title });
    }
  });

  test.afterAll(async () => {
    await client?.removeProject(projectId).catch(() => undefined);
    await client?.close().catch(() => undefined);
    await tempRepo?.cleanup();
  });

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    test(`applies inline search options and restores focus at ${viewport.width}px`, async ({
      page,
    }) => {
      const requests = trackHistoryRequests(page);
      await resetSeededPageState(page);
      await openSessions(page);
      await page.setViewportSize(viewport);
      const input = page.getByTestId("sessions-search-input");
      await expect(input).toBeFocused();
      const caseSensitive = page.getByTestId("sessions-search-caseSensitive");
      const wholeWord = page.getByTestId("sessions-search-wholeWord");
      const regex = page.getByTestId("sessions-search-regex");

      await search(page, `${NONCE} "mai`);
      await expectVisibleTitles(page, [TITLES.unbilled, TITLES.billing, TITLES.terminal]);
      await search(page, `${NONCE} "Stripe bill`);
      await expectVisibleTitles(page, [TITLES.billing]);
      await search(page, `${NONCE} "Stripe billing"`);
      await expectVisibleTitles(page, [TITLES.billing]);
      await search(page, `${NONCE} "Stripe  billing"`);
      await expect(page.getByTestId("sessions-empty")).toBeVisible();

      await search(page, `${NONCE} stripe`);
      await expectVisibleTitles(page, [TITLES.billing]);
      await caseSensitive.click();
      await expect(caseSensitive).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("sessions-empty")).toBeVisible();
      await search(page, `${NONCE} Stripe`);
      await expectVisibleTitles(page, [TITLES.billing]);
      await expect(
        rowTitles(page).filter({ hasText: NONCE }).getByText("Stripe", { exact: true }),
      ).toBeVisible();
      await caseSensitive.click();

      await wholeWord.click();
      await search(page, `${NONCE} bill`);
      await expect(page.getByTestId("sessions-empty")).toBeVisible();
      await regex.click();
      await expect(wholeWord).toBeEnabled();
      await expect(wholeWord).toHaveAttribute("aria-pressed", "true");
      await search(page, `${NONCE}.*bill`);
      await expect(page.getByTestId("sessions-empty")).toBeVisible();
      await wholeWord.click();
      await expectVisibleTitles(page, [TITLES.unbilled, TITLES.billing]);
      await wholeWord.click();
      await search(page, `${NONCE}.*(billing|usage)`);
      await expectVisibleTitles(page, [TITLES.unbilled, TITLES.billing]);
      await page.screenshot({
        path: test.info().outputPath(`history-search-${viewport.width}.png`),
      });
      const requestCount = requests.length;
      await search(page, "[");
      await expect(page.getByTestId("sessions-search-error")).toBeVisible();
      await expect(rowTitles(page)).toHaveCount(0);
      await page.screenshot({
        path: test.info().outputPath(`history-search-invalid-${viewport.width}.png`),
      });
      // Wait through the debounce to prove invalid input sends no history request.
      await page.waitForTimeout(300);
      expect(requests).toHaveLength(requestCount);
      await search(page, `${NONCE}.*billing`);
      await expect(page.getByTestId("sessions-search-error")).toHaveCount(0);
      await expectVisibleTitles(page, [TITLES.billing]);
      expect(
        requests.some((request) => request.searchOptions?.regex && request.search === "["),
      ).toBe(false);
      await regex.click();
      await expect(wholeWord).toBeEnabled();
      await expect(wholeWord).toHaveAttribute("aria-pressed", "true");
      await search(page, `${NONCE} main`);
      await expectVisibleTitles(page, [TITLES.unbilled, TITLES.billing, TITLES.terminal]);

      await rowTitles(page).filter({ hasText: NONCE }).first().click();
      if (viewport.width < 600) {
        await openMobileAgentSidebar(page);
        await expectMobileAgentSidebarVisible(page);
      }
      await openSessions(page);
      await expect(page.getByTestId("sessions-search-input")).toBeFocused();
      await expect(page.getByTestId("sessions-search-input")).toHaveValue("");
    });

    test(`restores recent searches from the search icon at ${viewport.width}px`, async ({
      page,
    }) => {
      await resetSeededPageState(page);
      await openSessions(page);
      await page.setViewportSize(viewport);
      const input = page.getByTestId("sessions-search-input");
      const trigger = page.getByTestId("sessions-search-history-trigger");
      const menu = page.getByTestId("sessions-search-history-menu");

      await trigger.click();
      await expect(menu.getByText("No recent searches", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");

      await input.fill(`${NONCE} billing`);
      await input.press("Enter");
      await page.getByTestId("sessions-search-clear").click();
      await input.fill(`${NONCE} terminal`);
      await trigger.click();
      await expect(menu.getByRole("menuitem")).toHaveText([
        `${NONCE} terminal`,
        `${NONCE} billing`,
      ]);
      await expect(menu).toHaveCSS("opacity", "1");
      await page.screenshot({ path: test.info().outputPath("search-history.png") });
      await menu.getByRole("menuitem", { name: `${NONCE} billing`, exact: true }).click();
      await expect(input).toHaveValue(`${NONCE} billing`);
      await expect(menu).toHaveCount(0);
      await expectVisibleTitles(page, [TITLES.billing]);

      await page.reload();
      await trigger.click();
      await expect(menu.getByRole("menuitem")).toHaveText([
        `${NONCE} billing`,
        `${NONCE} terminal`,
      ]);
      await menu.getByRole("menuitem", { name: `${NONCE} terminal`, exact: true }).click();
      await expect(input).toHaveValue(`${NONCE} terminal`);
      await expectVisibleTitles(page, [TITLES.terminal]);
    });

    test(`filters agent types and toggles subagent badges at ${viewport.width}px`, async ({
      page,
    }) => {
      const nonce = `agenttype${randomUUID().replaceAll("-", "").slice(0, 8)}`;
      const parent = await createMockIdleAgent(client, {
        cwd: tempRepo.path,
        workspaceId,
        title: `${nonce} parent`,
      });
      const child = await client.createAgent({
        provider: "mock",
        model: "e2e-fast-stream",
        modeId: "load-test",
        cwd: tempRepo.path,
        workspaceId,
        title: `${nonce} child`,
        labels: { "paseo.parent-agent-id": parent.id },
      });
      await client.waitForAgentUpsert(child.id, (agent) => agent.status === "idle", 30_000);
      await client.archiveAgent(child.id);
      await resetSeededPageState(page);
      await openSessions(page);
      await page.setViewportSize(viewport);
      await search(page, nonce);
      const rows = rowTitles(page).filter({ hasText: nonce });
      const childRow = rows.filter({ hasText: `${nonce} child` });
      await expect(rows).toHaveCount(2);
      await expect(childRow.getByText("Subagent", { exact: true })).toBeVisible();
      await expect(childRow.getByText("Archived", { exact: true })).toBeVisible();
      expect(
        await childRow
          .getByText("Subagent", { exact: true })
          .evaluate((element) => element.parentElement?.nextElementSibling?.textContent),
      ).toBe("Archived");
      await expect(
        rows.filter({ hasText: `${nonce} parent` }).getByText("Subagent", { exact: true }),
      ).toHaveCount(0);

      const compact = viewport.width < 600;
      async function closeMenu() {
        if (compact) {
          await page
            .getByRole("button", { name: "Bottom sheet backdrop" })
            .click({ position: { x: 16, y: 16 } });
        } else {
          await page.keyboard.press("Escape");
        }
      }
      async function selectType(type: string) {
        await page
          .getByTestId(compact ? "sessions-filters-trigger" : "sessions-agentType-filter-trigger")
          .click();
        const all = page.getByTestId("sessions-agentType-filter-all");
        if (type === "all") {
          await all.click();
        } else {
          if ((await all.textContent()) === "Select all") await all.click();
          await all.click();
          await page.getByTestId(`sessions-agentType-filter-${type}`).click();
        }
        await closeMenu();
      }
      await selectType("item-main");
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(`${nonce} parent`);
      await selectType("item-subagent");
      await expect(rows).toHaveCount(1);
      await expect(childRow).toBeVisible();

      await page.getByTestId("sessions-display-trigger").click();
      await page.getByTestId("sessions-display-subagent").click();
      await closeMenu();
      await expect(childRow.getByText("Subagent", { exact: true })).toHaveCount(0);
      await expect(childRow.getByText("Archived", { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByTestId("sessions-search-input")).toBeVisible();
      await search(page, nonce);
      await expect(rows).toHaveCount(1);
      await expect(childRow).toBeVisible();
      await expect(childRow.getByText("Subagent", { exact: true })).toHaveCount(0);
      await page.getByTestId("sessions-display-trigger").click();
      await expect(page.getByTestId("sessions-display-subagent")).toHaveAttribute(
        "aria-checked",
        "false",
      );
      await page.getByTestId("sessions-display-subagent").click();
      await closeMenu();
      await expect(childRow.getByText("Subagent", { exact: true })).toBeVisible();
      await selectType("all");
      await expect(rows).toHaveCount(2);
    });

    test(`filters chronological history and highlights matches at ${viewport.width}px`, async ({
      page,
    }) => {
      await resetSeededPageState(page);
      await openSessions(page);
      await page.setViewportSize(viewport);

      await verifyChronologicalFiltering(page);

      await verifyRecencyBeforeMatchStrength(page);

      await verifyExactAndTypoHighlights(page);

      await verifyAllSearchFieldHighlights(page, tempRepo.path);

      await verifyEmptySearchAndRecovery(page);
    });
  }

  test("shows the worktree folder instead of the workspace title", async ({ page }) => {
    const worktreeSlug = "history-folder-worktree";
    const created = await client.createWorkspace({
      source: { kind: "worktree", cwd: tempRepo.path, projectId, worktreeSlug },
      title: "Review history folder labels",
    });
    if (!created.workspace) {
      throw new Error(created.error ?? "Failed to create history worktree");
    }
    const agent = await createMockIdleAgent(client, {
      cwd: created.workspace.workspaceDirectory,
      workspaceId: created.workspace.id,
      title: "Worktree folder label",
    });

    await resetSeededPageState(page);
    await openSessions(page);
    const row = page.getByTestId(new RegExp(`^agent-row-workspace-(?!name-).*-${agent.id}$`));
    await expect(row).toHaveText(worktreeSlug);
  });
});
