import { expect, test } from "../support/fixtures";
import { verifyDelayedWorkspaceCreation } from "../support/helpers/new-workspace-navigation";
import { gotoAppShell } from "../support/helpers/app";
import {
  connectNewWorkspaceDaemonClient,
  delayBrowserWorkspaceCreatedResponse,
  openNewWorkspaceComposer,
  openProjectViaDaemon,
  selectWorkspaceIsolation,
  submitNewWorkspacePrompt,
  waitForCreatedWorkspace,
} from "../support/helpers/new-workspace";
import { createTempGitRepo } from "../support/helpers/workspace";
import { getServerId } from "../support/helpers/server-id";
import {
  switchWorkspaceViaSidebar,
  waitForSidebarHydration,
} from "../support/helpers/workspace-ui";

test.describe("Delayed workspace creation", () => {
  test.describe.configure({ timeout: 120_000 });

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
      await openNewWorkspaceComposer(page, project);
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
