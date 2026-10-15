import { randomUUID } from "node:crypto";
import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { openSessions } from "../support/helpers/archive-tab";
import { createMockIdleAgent } from "../support/helpers/archive-tab";
import {
  addConnectedHostAndReload,
  addOfflineHostAndReload,
  reloadPreservingHostRegistry,
} from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { connectSeedClient, seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const PRIMARY_LABEL = "Primary box";
const SECONDARY_LABEL = "Secondary box";

/** Scopes every assertion to this spec's sessions on a shared daemon. */
const NONCE = `hsx${randomUUID().replaceAll("-", "").slice(0, 8)}`;

async function search(page: Page, query: string): Promise<void> {
  await page.getByTestId("sessions-search-input").fill(query);
}

async function selectHost(page: Page, serverId: string): Promise<void> {
  await page.getByTestId("sessions-hosts-filter-trigger").click();
  await page.getByTestId(`sessions-hosts-filter-item-${serverId}`).click();
  await page.keyboard.press("Escape");
}

async function expectChronologicalTitles(page: Page, titles: string[]): Promise<void> {
  const rows = page
    .getByRole("button")
    .and(page.getByTestId(/^agent-row-/))
    .filter({ hasText: NONCE });
  await expect(rows).toHaveCount(titles.length, { timeout: 30_000 });
  for (const [index, title] of titles.entries()) {
    await expect(rows.nth(index)).toContainText(title, { timeout: 30_000 });
  }
}

async function expectArchivedMetadata(row: Locator): Promise<void> {
  const label = row.getByText("Archived", { exact: true });
  const badge = label.locator("..");
  const metadata = badge.locator("..");
  const turns = metadata.getByText("0 turns", { exact: false });
  await expect(turns).toBeVisible();
  expect(
    await badge.evaluate((element) => element === element.parentElement?.lastElementChild),
  ).toBe(true);
  const fontSize = await turns.evaluate((element) => getComputedStyle(element).fontSize);
  await expect(label).toHaveCSS("font-size", fontSize);
}

async function expectHistoryToolbar({
  page,
  compact = false,
}: {
  page: Page;
  compact?: boolean;
}): Promise<void> {
  await expect
    .poll(async () => {
      const searchBounds = await page.getByTestId("sessions-search-input").evaluate((element) => {
        let frame = element.parentElement;
        while (frame && !Number.parseFloat(getComputedStyle(frame).borderTopWidth))
          frame = frame.parentElement;
        if (!frame) return;
        const bounds = frame.getBoundingClientRect();
        return { x: bounds.x, width: bounds.width };
      });
      if (!searchBounds) return;
      const railBounds = await page
        .getByTestId("sessions-display-trigger")
        .locator("..")
        .evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return { x: bounds.x, width: bounds.width };
        });
      return {
        leftAligned: Math.abs(searchBounds.x - railBounds.x) < 1,
        fullWidth: Math.abs(searchBounds.width - railBounds.width) < 1,
      };
    })
    .toEqual({ leftAligned: true, fullWidth: true });
  const triggers = compact
    ? ["sessions-filters-trigger"]
    : ["hosts", "projects", "providers", "models", "status"].map(
        (group) => `sessions-${group}-filter-trigger`,
      );
  for (const trigger of [...triggers, "sessions-display-trigger"]) {
    await expect(page.getByTestId(trigger)).toHaveCSS("border-top-width", "0px");
    await expect(page.getByTestId(trigger)).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
}

// Searching across hosts merges each host's chronological matching sessions.
test.describe("History search across hosts", () => {
  test.describe.configure({ timeout: 420_000 });

  test("orders matches from every host chronologically and narrows to one host on demand", async ({
    page,
  }) => {
    const secondaryServerId = `srv_hist_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const secondaryDaemon = await startIsolatedHostDaemon(secondaryServerId);
    const primaryClient = await connectSeedClient();
    let primaryWorkspace: Awaited<ReturnType<typeof seedWorkspace>> | null = null;
    let secondaryWorkspace: Awaited<ReturnType<typeof seedWorkspace>> | null = null;

    // The weak match is the newest session on the primary host and the strong
    // match is the oldest on the secondary; chronology must win over relevance.
    const weakTitle = `${NONCE} Unbilled usage report`;
    const strongTitle = `${NONCE} Bill the customer`;
    const unrelatedTitle = `${NONCE} Terminal resize fix`;

    try {
      secondaryWorkspace = await seedWorkspace({
        repoPrefix: "sessions-search-secondary-",
        port: secondaryDaemon.port,
      });
      await createMockIdleAgent(secondaryWorkspace.client, {
        cwd: secondaryWorkspace.repoPath,
        workspaceId: secondaryWorkspace.workspaceId,
        title: strongTitle,
      });

      primaryWorkspace = await seedWorkspace({ repoPrefix: "sessions-search-primary-" });
      for (const title of [unrelatedTitle, weakTitle]) {
        await createMockIdleAgent(primaryClient, {
          cwd: primaryWorkspace.repoPath,
          workspaceId: primaryWorkspace.workspaceId,
          title,
        });
      }

      await gotoAppShell(page);
      await addConnectedHostAndReload(page, {
        serverId: secondaryDaemon.serverId,
        label: SECONDARY_LABEL,
        port: secondaryDaemon.port,
        primaryLabel: PRIMARY_LABEL,
      });
      await openSessions(page);

      // All hosts: the newer partial match leads.
      await search(page, `${NONCE} bill`);
      await expectChronologicalTitles(page, [weakTitle, strongTitle]);

      // One host: the other daemon's stronger match drops out entirely.
      await selectHost(page, getServerId());
      await expectChronologicalTitles(page, [weakTitle]);

      await selectHost(page, secondaryDaemon.serverId);
      await expectChronologicalTitles(page, [weakTitle, strongTitle]);
      await selectHost(page, getServerId());
      await expectChronologicalTitles(page, [strongTitle]);

      // Back to all hosts, and clearing the query returns every seeded session.
      await page.getByTestId("sessions-hosts-filter-trigger").click();
      await page.getByTestId("sessions-hosts-filter-all").click();
      await page.keyboard.press("Escape");
      await page.getByTestId("sessions-search-clear").click();
      const rows = page
        .getByRole("button")
        .and(page.getByTestId(/^agent-row-/))
        .filter({ hasText: NONCE });
      await expect(rows).toHaveCount(3, { timeout: 30_000 });
    } finally {
      await primaryWorkspace?.cleanup().catch(() => undefined);
      await secondaryWorkspace?.cleanup().catch(() => undefined);
      await primaryClient.close().catch(() => undefined);
      await secondaryDaemon.close().catch(() => undefined);
    }
  });

  test("combines project, provider, model and archive filters on desktop and compact layouts", async ({
    page,
  }, testInfo) => {
    const firstWorkspace = await seedWorkspace({ repoPrefix: "history-filters-first-" });
    const secondWorkspace = await seedWorkspace({ repoPrefix: "history-filters-second-" });
    const activeTitle = `${NONCE} Active history filter session`;
    const archivedTitle = `${NONCE} Archived history filter session`;
    try {
      await createMockIdleAgent(firstWorkspace.client, {
        cwd: firstWorkspace.repoPath,
        workspaceId: firstWorkspace.workspaceId,
        title: activeTitle,
      });
      const archived = await createMockIdleAgent(secondWorkspace.client, {
        cwd: secondWorkspace.repoPath,
        workspaceId: secondWorkspace.workspaceId,
        title: archivedTitle,
      });
      await secondWorkspace.client.archiveAgent(archived.id);
      await gotoAppShell(page);
      await openSessions(page);
      await search(page, NONCE);
      await expectChronologicalTitles(page, [archivedTitle, activeTitle]);
      await expectHistoryToolbar({ page });
      const toolbar = page.getByTestId("sessions-display-trigger").locator("..");
      const toolbarHeight = await toolbar.evaluate(
        (element) => element.getBoundingClientRect().height,
      );
      for (const group of ["hosts", "projects", "providers", "models"]) {
        await page.getByTestId(`sessions-${group}-filter-trigger`).click();
        await page.getByTestId(`sessions-${group}-filter-all`).click();
        await expect(page.getByTestId(`sessions-${group}-filter-all`)).not.toBeVisible();
      }
      const archivedRow = page
        .getByRole("button")
        .and(page.getByTestId(/^agent-row-/))
        .filter({ hasText: archivedTitle });
      await expectArchivedMetadata(archivedRow);
      const activeRow = page
        .getByRole("button")
        .and(page.getByTestId(/^agent-row-/))
        .filter({ hasText: activeTitle });
      await expect(activeRow).toContainText("0 turns");
      const archivedHeight = await archivedRow.evaluate(
        (element) => element.getBoundingClientRect().height,
      );
      const activeTop = await activeRow.evaluate((element) => element.getBoundingClientRect().y);
      await page.getByTestId("sessions-display-trigger").click();
      for (const enabled of [false, true]) {
        await page.getByTestId("sessions-display-status").click();
        await expect(page.getByTestId("sessions-display-status")).toHaveAttribute(
          "aria-checked",
          String(enabled),
        );
        await expect
          .poll(async () => (await archivedRow.boundingBox())?.height)
          .toBe(archivedHeight);
        await expect.poll(async () => (await activeRow.boundingBox())?.y).toBe(activeTop);
      }
      await page.keyboard.press("Escape");
      await expect(
        page
          .getByRole("button")
          .and(page.getByTestId(/^agent-row-/))
          .filter({ hasText: activeTitle }),
      ).toContainText("e2e-fast-stream");
      await expect(
        page
          .getByRole("button")
          .and(page.getByTestId(/^agent-row-/))
          .filter({ hasText: activeTitle }),
      ).toContainText("Cost unavailable");
      await expect(page.getByTestId("sessions-status-filter-trigger")).toHaveAttribute(
        "role",
        "button",
      );
      await page.getByTestId("sessions-status-filter-trigger").click();
      await page.getByTestId("sessions-status-filter-item-archived").click();
      await expect(page.getByTestId("sessions-status-filter-all")).not.toBeVisible();
      await expectChronologicalTitles(page, [archivedTitle]);
      await expect(toolbar).toHaveCSS("height", `${toolbarHeight}px`);
      const filteredListTop = await archivedRow.evaluate(
        (element) => element.getBoundingClientRect().y,
      );
      await page.getByRole("button", { name: "Clear filters", exact: true }).click();
      await expectChronologicalTitles(page, [archivedTitle, activeTitle]);
      await expect(toolbar).toHaveCSS("height", `${toolbarHeight}px`);
      await expect.poll(async () => (await archivedRow.boundingBox())?.y).toBe(filteredListTop);
      await page.getByTestId("sessions-status-filter-trigger").click();
      await page.getByTestId("sessions-status-filter-all").click();
      await expect(page.getByTestId("sessions-status-filter-all")).not.toBeVisible();
      await expectChronologicalTitles(page, [archivedTitle, activeTitle]);
      await page.getByTestId("sessions-status-filter-trigger").click();
      await page.getByTestId("sessions-status-filter-item-active").click();
      await expect(page.getByTestId("sessions-status-filter-all")).not.toBeVisible();
      await expectChronologicalTitles(page, [activeTitle]);
      await page.getByTestId("sessions-projects-filter-trigger").click();
      const projectItems = page.getByTestId(/^sessions-projects-filter-item-/);
      await expect(projectItems).toHaveCount(2);
      await projectItems.filter({ hasText: firstWorkspace.repoPath.split("/").pop()! }).click();
      await projectItems.filter({ hasText: secondWorkspace.repoPath.split("/").pop()! }).click();
      await page.keyboard.press("Escape");
      await page.getByTestId("sessions-providers-filter-trigger").click();
      await page.getByTestId("sessions-providers-filter-item-mock").click();
      await page.keyboard.press("Escape");
      await page.getByTestId("sessions-models-filter-trigger").click();
      await page.getByTestId('sessions-models-filter-item-["mock","e2e-fast-stream"]').click();
      await page.keyboard.press("Escape");
      await expectChronologicalTitles(page, [activeTitle]);
      await selectHost(page, getServerId());
      await page.getByTestId("sessions-display-trigger").click();
      await expect(page.getByTestId("sessions-display-model")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await page.screenshot({ path: testInfo.outputPath("history-display-menu.png") });
      await page.getByTestId("sessions-display-model").click();
      await page.getByTestId("sessions-display-cost").click();
      await page.getByTestId("sessions-display-project").click();
      await page.getByTestId("sessions-display-turns").click();
      await expect(page.getByTestId("sessions-display-model")).toHaveAttribute(
        "aria-checked",
        "false",
      );
      await page.keyboard.press("Escape");
      await expect(activeRow).not.toContainText("e2e-fast-stream");
      await expect(activeRow).not.toContainText("Cost unavailable");
      await expect(activeRow).not.toContainText("0 turns");
      await expect(activeRow.getByTestId(/^agent-row-project-/)).toHaveCount(0);
      await expect(activeRow.getByTestId(/^agent-row-workspace-/)).toBeVisible();
      await activeRow.click();
      await expect(page).toHaveURL(/\/workspace\//);
      await openSessions(page);
      await expectChronologicalTitles(page, [activeTitle]);
      await expect(page.getByTestId("sessions-search-input")).toHaveValue("");
      await expect(page.getByTestId("sessions-status-filter-trigger")).toContainText("Active");
      await expect(activeRow).not.toContainText("e2e-fast-stream");
      await reloadPreservingHostRegistry(page);
      await expectChronologicalTitles(page, [activeTitle]);
      await page.getByTestId("sessions-display-trigger").click();
      await expect(page.getByTestId("sessions-display-model")).toHaveAttribute(
        "aria-checked",
        "false",
      );
      await page.getByTestId("sessions-display-turns").click();
      await page.keyboard.press("Escape");
      await expect(activeRow).toContainText("0 turns");
      await page.getByTestId("sessions-projects-filter-trigger").click();
      await expect(page.getByTestId(/^sessions-projects-filter-item-/)).toHaveCount(2);
      await expect(page.getByTestId(/^sessions-projects-filter-item-/).nth(0)).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(page.getByTestId(/^sessions-projects-filter-item-/).nth(1)).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await page.keyboard.press("Escape");
      await page.screenshot({ path: testInfo.outputPath("history-desktop.png") });
      await page.setViewportSize({ width: 390, height: 844 });
      await expectHistoryToolbar({ page, compact: true });
      await expect(page.getByTestId("sessions-filters-trigger")).toHaveAttribute("role", "button");
      await page.getByTestId("sessions-filters-trigger").click();
      await expect(page.getByTestId("sessions-filters-sheet-content")).toBeVisible();
      await page.getByTestId("sessions-hosts-filter-all").click();
      await expect(page.getByTestId("sessions-filters-sheet-content")).not.toBeVisible();
      await page.getByTestId("sessions-filters-trigger").click();
      await page.getByTestId(`sessions-hosts-filter-item-${getServerId()}`).click();
      await expect(page.getByTestId("sessions-filters-sheet-content")).toBeVisible();
      await page.getByTestId("sessions-status-filter-item-archived").click();
      await page.screenshot({ path: testInfo.outputPath("history-compact-filters.png") });
      await page
        .getByRole("button", { name: "Bottom sheet backdrop" })
        .click({ position: { x: 16, y: 16 } });
      await expect(page.getByTestId("sessions-filters-sheet-content")).not.toBeVisible();
      await expectChronologicalTitles(page, [archivedTitle]);
      await expectArchivedMetadata(archivedRow);
      await page.getByTestId("sessions-display-trigger").click();
      await expect(page.getByTestId("sessions-display-model")).toHaveAttribute(
        "aria-checked",
        "false",
      );
      await page.getByTestId("sessions-display-status").click();
      await page
        .getByRole("button", { name: "Bottom sheet backdrop" })
        .click({ position: { x: 16, y: 16 } });
      await expect(archivedRow.getByText("Archived", { exact: true })).toHaveCount(0);
      await reloadPreservingHostRegistry(page);
      await expectChronologicalTitles(page, [archivedTitle]);
      await expect(archivedRow).not.toContainText("Cost unavailable");
      await page.getByTestId("sessions-filters-trigger").click();
      await expect(page.getByTestId("sessions-status-filter-item-archived")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await page
        .getByRole("button", { name: "Bottom sheet backdrop" })
        .click({ position: { x: 16, y: 16 } });
      await page.screenshot({ path: testInfo.outputPath("history-compact.png") });
    } finally {
      await firstWorkspace.cleanup();
      await secondWorkspace.cleanup();
    }
  });

  test("retries saving History choices after browser storage is full", async ({
    page,
  }, testInfo) => {
    const workspace = await seedWorkspace({ repoPrefix: "history-save-retry-" });
    const title = `${NONCE} Save preferences recovery`;
    try {
      await createMockIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title,
      });
      await gotoAppShell(page);
      await openSessions(page);
      const row = page
        .getByRole("button")
        .and(page.getByTestId(/^agent-row-/))
        .filter({ hasText: title });
      await expect(row).toContainText("e2e-fast-stream");
      await page.getByTestId("sessions-display-trigger").click();
      await page.evaluate(() => {
        let size = 1024 * 1024;
        let index = 0;
        while (size > 0) {
          try {
            localStorage.setItem(`history-quota-${index}`, "x".repeat(size));
            index += 1;
          } catch (error) {
            if (!(error instanceof DOMException) || error.name !== "QuotaExceededError")
              throw error;
            size = Math.floor(size / 2);
          }
        }
        for (;;) {
          try {
            localStorage.setItem("history-quota-0", `${localStorage.getItem("history-quota-0")}x`);
          } catch (error) {
            if (!(error instanceof DOMException) || error.name !== "QuotaExceededError")
              throw error;
            break;
          }
        }
      });
      await page.getByTestId("sessions-display-model").click();
      await page.keyboard.press("Escape");
      const error = page.getByTestId("sessions-preferences-error");
      await expect(error).toContainText("Couldn't save History preferences");
      await expect(row).not.toContainText("e2e-fast-stream");
      await page.screenshot({ path: testInfo.outputPath("history-save-error.png") });
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("history-quota-")) localStorage.removeItem(key);
        }
      });
      await error.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(error).toHaveCount(0);
      await reloadPreservingHostRegistry(page);
      await expect(row).toBeVisible();
      await expect(row).not.toContainText("e2e-fast-stream");
      await page.getByTestId("sessions-display-trigger").click();
      await expect(page.getByTestId("sessions-display-model")).toHaveAttribute(
        "aria-checked",
        "false",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  test("shows live sidebar status on the provider icon before the History title", async ({
    page,
  }, testInfo) => {
    const title = `${NONCE} Live session status`;
    const session = await seedMockAgentWorkspace({
      repoPrefix: "history-session-status-",
      title,
      model: "ten-second-stream",
    });
    try {
      await session.client.waitForAgentUpsert(session.agentId, (agent) => agent.status === "idle");
      await gotoAppShell(page);
      await openSessions(page);
      const row = page.getByTestId(`agent-row-${getServerId()}-${session.agentId}`);
      const icon = row.getByTestId(`agent-row-icon-${getServerId()}-${session.agentId}`);
      const titleId = `agent-row-title-${getServerId()}-${session.agentId}`;
      await expect(icon).toHaveAccessibleName("Done");
      expect(
        await icon.evaluate((element) => element.nextElementSibling?.getAttribute("data-testid")),
      ).toBe(titleId);

      await session.client.sendAgentMessage(
        session.agentId,
        "Stream a normal mock turn for History status.",
      );
      await expect(icon).toHaveAccessibleName("Working");
      const ring = icon.getByRole("progressbar", { name: "Agent running" });
      await expect(ring).toBeVisible();
      expect(
        await ring.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            const clip = parent.getBoundingClientRect();
            const clipsX = ["hidden", "clip", "auto", "scroll"].includes(style.overflowX);
            const clipsY = ["hidden", "clip", "auto", "scroll"].includes(style.overflowY);
            if (clipsX && (bounds.left < clip.left || bounds.right > clip.right)) return false;
            if (clipsY && (bounds.top < clip.top || bounds.bottom > clip.bottom)) return false;
          }
          return true;
        }),
      ).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("history-session-running.png") });
      await session.client.waitForFinish(session.agentId, 30_000);
      await expect(icon).toHaveAccessibleName("Ready to review");
      await expect(icon.getByRole("progressbar")).toHaveCount(0);
      await expect(row).toContainText("1 turn");

      await session.client.clearWorkspaceAttention(session.workspaceId);
      await expect(icon).toHaveAccessibleName("Done");
      await session.client.sendAgentMessage(session.agentId, "emit a synthetic turn failure");
      await expect(icon).toHaveAccessibleName("Failed", { timeout: 30_000 });
      await page.screenshot({ path: testInfo.outputPath("history-session-failed.png") });

      await page.getByTestId("sessions-display-trigger").click();
      await page.getByTestId("sessions-display-status").click();
      await page.keyboard.press("Escape");
      await expect(icon).toHaveAccessibleName("");
      await page.getByTestId("sessions-display-trigger").click();
      await page.getByTestId("sessions-display-status").click();
      await page.getByTestId("sessions-display-provider").click();
      await page.keyboard.press("Escape");
      await expect(icon).toHaveCount(0);
      await expect(row.getByTestId(titleId)).toBeVisible();
      await page.getByTestId("sessions-display-trigger").click();
      await page.getByTestId("sessions-display-provider").click();
      await page.keyboard.press("Escape");
      await expect(icon).toHaveAccessibleName("Failed");

      await session.client.sendAgentMessage(session.agentId, "emit a synthetic plan approval");
      await expect(icon).toHaveAccessibleName("Needs input", { timeout: 30_000 });
    } finally {
      await session.cleanup();
    }
  });

  test("clears the query text when resetting empty History filters", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "history-clear-filters-" });
    const title = `${NONCE} Clear filters recovery`;
    try {
      await createMockIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title,
      });
      await gotoAppShell(page);
      await openSessions(page);
      await search(page, `${NONCE} nonexistentquery`);
      const empty = page.getByTestId("sessions-empty");
      await expect(empty).toBeVisible();
      await empty.getByRole("button", { name: "Clear filters", exact: true }).click();
      await expect(page.getByTestId("sessions-search-input")).toHaveValue("");
      await expect(page.getByTestId("sessions-search-clear")).not.toBeVisible();
      await expectChronologicalTitles(page, [title]);
    } finally {
      await workspace.cleanup();
    }
  });

  test("names a host it could not reach instead of shrinking the results silently", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sessions-search-offline-" });
    const reachableTitle = `${NONCE} Bill the reachable customer`;

    try {
      await createMockIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: reachableTitle,
      });

      await gotoAppShell(page);
      await addOfflineHostAndReload(page, {
        serverId: "sessions-search-unreachable",
        label: SECONDARY_LABEL,
        primaryLabel: PRIMARY_LABEL,
      });
      await openSessions(page);

      // The unreachable host's sessions were never searched. Reporting only the
      // matches that were found, with no word about the host that never
      // answered, is the failure this asserts against.
      await search(page, `${NONCE} bill`);
      await expect(page.getByTestId("sessions-host-errors")).toContainText(SECONDARY_LABEL, {
        timeout: 30_000,
      });
      await expectChronologicalTitles(page, [reachableTitle]);
    } finally {
      await workspace.cleanup().catch(() => undefined);
    }
  });
});
