import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";
import { getServerId } from "../support/helpers/server-id";

function workspaceRowTestId(workspaceId: string): string {
  return `sidebar-workspace-row-${getServerId()}:${workspaceId}`;
}

function workspaceRenameModalTestId(workspaceId: string, suffix: string): string {
  return `sidebar-workspace-rename-modal-${getServerId()}:${workspaceId}-${suffix}`;
}

async function openRenameModal(page: Page, workspaceId: string) {
  const serverId = getServerId();
  const row = page.getByTestId(`sidebar-workspace-row-${serverId}:${workspaceId}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();

  const kebab = page.getByTestId(`sidebar-workspace-kebab-${serverId}:${workspaceId}`);
  await expect(kebab).toBeVisible({ timeout: 10_000 });
  await kebab.click();

  const renameItem = page.getByTestId(`sidebar-workspace-menu-rename-${serverId}:${workspaceId}`);
  await expect(renameItem).toBeVisible({ timeout: 10_000 });
  await renameItem.click();

  const input = page.getByTestId(workspaceRenameModalTestId(workspaceId, "input"));
  await expect(input).toBeVisible({ timeout: 10_000 });
  return input;
}

// In Model B the workspace title is its identity: renaming sets a custom title
// layered over the derived branch/directory name, and reconciliation never
// touches it. The sidebar row shows the title verbatim — no branch mutation.
test.use({
  e2eDaemonConfig: {
    version: 1,
    agents: { metadataGeneration: { providers: [{ provider: "mock", model: "e2e-fast-stream" }] } },
  },
});

test.describe("Sidebar workspace rename", () => {
  test("AI rename updates workspace and chat names through the metadata model", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const workspace = await seedWorkspace({
      repoPrefix: "sidebar-ai-rename-",
      title: "Original workspace",
    });
    try {
      const first = await workspace.client.createAgent({
        provider: "mock",
        model: "e2e-fast-stream",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "First chat",
        initialPrompt: "Fix payment retries",
      });
      const second = await workspace.client.createAgent({
        provider: "mock",
        model: "e2e-fast-stream",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Second chat",
        initialPrompt: "Add billing checks",
      });
      await workspace.client.waitForFinish(first.id, 30_000);
      await workspace.client.waitForFinish(second.id, 30_000);
      await page.goto(buildHostAgentDetailRoute(getServerId(), second.id, workspace.workspaceId));
      await waitForWorkspaceTabsVisible(page);
      const row = page.getByTestId(workspaceRowTestId(workspace.workspaceId));
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.hover();
      await page
        .getByTestId(`sidebar-workspace-kebab-${getServerId()}:${workspace.workspaceId}`)
        .click();
      const workspaceAi = page.getByTestId(
        `sidebar-workspace-menu-rename-ai-${getServerId()}:${workspace.workspaceId}`,
      );
      await expect(workspaceAi).toHaveText("Rename workspace with AI");
      await workspaceAi.hover();
      await page.screenshot({
        path: testInfo.outputPath("workspace-ai-menu.png"),
        animations: "disabled",
      });
      await workspaceAi.click();
      await expect(row).toContainText("Fix payment retries", { timeout: 30_000 });
      const tab = page.getByTestId(`workspace-tab-agent_${second.id}`).first();
      await tab.click({ button: "right" });
      const chatAi = page.getByTestId(`workspace-tab-context-agent_${second.id}-rename-ai`);
      await expect(chatAi).toHaveText("Rename with AI");
      await chatAi.hover();
      await page.screenshot({
        path: testInfo.outputPath("chat-ai-menu.png"),
        animations: "disabled",
      });
      await chatAi.click();
      await expect(tab).toContainText("Add billing checks", { timeout: 30_000 });
      await page.reload();
      await expect(row).toContainText("Fix payment retries", { timeout: 30_000 });
      await expect(tab).toContainText("Add billing checks", { timeout: 30_000 });
    } finally {
      await workspace.cleanup();
    }
  });

  test("renaming via kebab sets a custom title that survives reload", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-rename-" });

    try {
      expect(workspace.workspaceName).toBe("main");

      await gotoAppShell(page);
      await expect(page.getByTestId(workspaceRowTestId(workspace.workspaceId))).toBeVisible({
        timeout: 30_000,
      });

      const input = await openRenameModal(page, workspace.workspaceId);
      await expect(input).toHaveValue("main");

      const customTitle = "Payments Refactor";
      await input.fill(customTitle);
      await page.getByTestId(workspaceRenameModalTestId(workspace.workspaceId, "submit")).click();

      await expect(input).toHaveCount(0, { timeout: 15_000 });
      // The title is shown exactly as typed — not slugified into a branch name.
      await expect(page.getByTestId(workspaceRowTestId(workspace.workspaceId))).toContainText(
        customTitle,
        { timeout: 15_000 },
      );

      // The custom title is backing metadata on the workspace: a full reload
      // re-resolves the descriptor from persistence and must not lose it. This
      // exercises the same descriptor resolution reconciliation re-runs against,
      // so a reconcile pass cannot overwrite the user's title either.
      await page.reload();
      await expect(page.getByTestId(workspaceRowTestId(workspace.workspaceId))).toContainText(
        customTitle,
        { timeout: 30_000 },
      );
    } finally {
      await workspace.cleanup();
    }
  });
});
