import { expect, test } from "../support/fixtures";
import { verifyDelayedWorkspaceCreation } from "../support/helpers/new-workspace-navigation";
import { gotoAppShell } from "../support/helpers/app";
import {
  connectNewWorkspaceDaemonClient,
  countWorkspaceAgents,
  delayBrowserWorkspaceCreatedResponse,
  openGlobalNewWorkspaceComposer,
  expectNewWorkspaceProjectSelected,
  openProjectViaDaemon,
  selectWorkspaceIsolation,
  submitNewWorkspacePrompt,
  waitForCreatedWorkspace,
} from "../support/helpers/new-workspace";
import { createTempGitRepo } from "../support/helpers/workspace";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace } from "../support/helpers/seed-client";
import { WORKSPACE_DECK_MAX_MOUNTED_WORKSPACES } from "@/screens/workspace/workspace-deck-retention";
import {
  switchWorkspaceViaSidebar,
  waitForSidebarHydration,
} from "../support/helpers/workspace-ui";

test.describe("Delayed workspace creation", () => {
  test.describe.configure({ timeout: 120_000 });

  test("finishing creation offscreen removes its draft before the agent is opened", async ({
    page,
  }) => {
    const project = await seedWorkspace({ repoPrefix: "workspace-background-handoff-" });
    const client = await connectNewWorkspaceDaemonClient();
    const delay = await delayBrowserWorkspaceCreatedResponse(page);
    const serverId = getServerId();
    const prompt = "Complete this agent while its workspace is offscreen.";
    try {
      const knownIds = new Set(
        (await project.client.fetchWorkspaces()).entries.map((entry) => entry.id),
      );
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: project.workspaceId });
      await openGlobalNewWorkspaceComposer(page);
      await selectWorkspaceIsolation(page, "worktree");
      await submitNewWorkspacePrompt(page, prompt);
      await delay.waitForCreateRequest();
      const workspace = await waitForCreatedWorkspace(client, knownIds);
      for (let index = 0; index < WORKSPACE_DECK_MAX_MOUNTED_WORKSPACES; index++) {
        const other = await project.client.createWorkspace({
          source: { kind: "directory", path: project.repoPath },
        });
        if (!other.workspace) throw new Error(other.error ?? "Failed to seed eviction workspace");
        await switchWorkspaceViaSidebar({ page, serverId, workspaceId: other.workspace.id });
      }
      await expect(
        page.getByTestId(`workspace-deck-entry-${serverId}:${workspace.id}`),
      ).toHaveCount(0);
      delay.release();
      await expect.poll(() => countWorkspaceAgents(client, workspace.id)).toBe(1);
      const agent = (await project.client.fetchAgents()).entries.find(
        (entry) => entry.agent.workspaceId === workspace.id,
      )!.agent;
      await page.getByTestId(`sidebar-workspace-session-agent:${agent.id}`).click();
      const deck = page.getByTestId(`workspace-deck-entry-${serverId}:${workspace.id}`);
      await expect(deck.locator('[data-testid^="workspace-tab-agent_"]')).toHaveCount(1);
      await expect(deck.locator('[data-testid^="workspace-tab-draft_"]')).toHaveCount(0);
      await expect(deck.getByTestId("user-message").filter({ hasText: prompt })).toBeVisible();
    } finally {
      delay.release();
      await client.close();
      await project.cleanup();
    }
  });

  test("chat worktree creation keeps the loading pane until its chat tab is ready", async ({
    page,
  }) => {
    const client = await connectNewWorkspaceDaemonClient();
    const repo = await createTempGitRepo("workspace-chat-handoff-");
    const delay = await delayBrowserWorkspaceCreatedResponse(page);
    const prompt = "Keep the worktree loading pane until this chat is ready";
    try {
      const project = await openProjectViaDaemon(client, repo.path);
      const knownIds = new Set((await client.fetchWorkspaces()).entries.map((entry) => entry.id));
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchWorkspaceViaSidebar({
        page,
        serverId: getServerId(),
        workspaceId: project.workspaceId,
      });
      await openGlobalNewWorkspaceComposer(page);
      await expectNewWorkspaceProjectSelected(page, project.projectDisplayName);
      await selectWorkspaceIsolation(page, "worktree");
      await submitNewWorkspacePrompt(page, prompt);
      await delay.waitForCreateRequest();

      const workspace = await waitForCreatedWorkspace(client, knownIds);
      await expect(
        page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.id}`),
      ).toBeVisible();
      await expect(
        page.getByTestId("workspace-new-tab-panel").filter({ visible: true }),
      ).toHaveCount(0);
      await expect(
        page.getByTestId("pending-workspace-pane").filter({ visible: true }),
      ).toBeVisible();

      delay.release();
      await expect(
        page.getByTestId("user-message").filter({ hasText: prompt, visible: true }),
      ).toBeVisible();
      await expect(page.getByTestId("pending-workspace-pane")).toHaveCount(0);
    } finally {
      delay.release();
      await client.close();
      await repo.cleanup();
    }
  });

  // Exercise each submit handler's navigation guard. Checkout isolation shares
  // those handlers; ordinary successful launches live in the creation journeys.
  test("chat worktree creation keeps the workspace chosen while it was pending", async ({
    page,
  }) => {
    await verifyDelayedWorkspaceCreation(page, "chat", "leave", "worktree");
  });

  test("terminal creation keeps the workspace chosen while it was pending", async ({ page }) => {
    await verifyDelayedWorkspaceCreation(page, "terminal", "leave");
  });

  test("empty creation keeps the workspace chosen while it was pending", async ({ page }) => {
    await verifyDelayedWorkspaceCreation(page, "empty", "leave");
  });

  test("preserves a newer draft opened while creation is pending", async ({ page }) => {
    await verifyDelayedWorkspaceCreation(page, "chat", "new-draft");
  });
});
