import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  closeProjectContextMenu,
  closeWorkspaceContextMenu,
  expectProjectContextMenuActions,
  expectWorkspaceContextMenuActions,
  expectWorkspaceContextMenuOwnsAttention,
  expectWorkspaceRowHoverCleared,
  openProjectContextMenu,
  openWorkspaceContextMenu,
  showWorkspaceHoverCard,
} from "../support/helpers/sidebar";

test.describe("Sidebar context menus", () => {
  test("right-clicking anywhere in a tab row opens its overflow actions", async ({ page }) => {
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "sidebar-tab-context-menu-",
      title: "Sidebar tab actions",
      initialPrompt: "Reply with a short greeting",
      featureValues: { mockAssistantResponse: "Hello from the sidebar preview" },
    });

    try {
      await gotoAppShell(page);
      const row = page
        .getByTestId(`sidebar-workspace-session-agent:${workspace.agentId}`)
        .filter({ visible: true });
      await expect(row).toBeVisible();
      await expect(row.getByText("Hello from the sidebar preview", { exact: true })).toBeVisible();
      const menu = page.getByTestId(`sidebar-workspace-session-menu-agent_${workspace.agentId}`);
      const initialUrl = page.url();

      await row.click({ button: "right", position: { x: 2, y: 2 } });
      await expect(menu).toBeVisible();
      await expect(page).toHaveURL(initialUrl);
      await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
      const renameModal = page.getByTestId(`workspace-tab-rename-modal-agent-${workspace.agentId}`);
      await expect(renameModal).toBeVisible();
      await renameModal.getByRole("button", { name: "Cancel", exact: true }).click();

      await openAgentRoute(page, workspace);

      await row.hover();
      await row.getByTestId(`sidebar-workspace-session-kebab-agent_${workspace.agentId}`).click();
      await expect(menu).toBeVisible();
      const overflowActions = await menu.getByRole("menuitem").allTextContents();
      await page.keyboard.press("Escape");
      await page.goto(initialUrl);
      await expect(row).toBeVisible();

      for (const target of [
        row.getByText("Sidebar tab actions", { exact: true }),
        row.getByText("Hello from the sidebar preview", { exact: true }),
        row,
      ]) {
        await target.click({ button: "right", position: { x: 2, y: 2 } });
        await expect(menu).toBeVisible();
        await expect(menu.getByRole("menuitem")).toHaveText(overflowActions);
        await page.keyboard.press("Escape");
        await expect(menu).not.toBeVisible();
      }
    } finally {
      await workspace.cleanup();
    }
  });

  test("right-clicking workspace and project rows opens their actions at the pointer", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-context-menu-" });

    try {
      await gotoAppShell(page);

      await showWorkspaceHoverCard(page, workspace.workspaceId);
      await openWorkspaceContextMenu(page, workspace.workspaceId);
      await expectWorkspaceContextMenuActions(page, workspace.workspaceId);
      await expectWorkspaceContextMenuOwnsAttention(page);

      await closeWorkspaceContextMenu(page, workspace.workspaceId);
      await expectWorkspaceRowHoverCleared(page, workspace.workspaceId);
      await openProjectContextMenu(page, workspace.projectViewKey);
      await expectProjectContextMenuActions(page, workspace.projectViewKey);

      await closeProjectContextMenu(page, workspace.projectViewKey);
    } finally {
      await workspace.cleanup();
    }
  });
});
