import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  expectNoBranchSwitcherInWorkspaceHeader,
  expectWorkspaceBranch,
  openChangesPanel,
} from "../support/helpers/branch-switcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { readWorktreeBranchInfo } from "../support/helpers/workspace";
import {
  switchWorkspaceViaSidebar,
  waitForSidebarHydration,
} from "../support/helpers/workspace-ui";

async function renameWorkspaceViaSidebar(
  page: Page,
  input: { workspaceId: string; title: string },
): Promise<void> {
  const serverId = getServerId();
  const row = page.getByTestId(`sidebar-workspace-row-${serverId}:${input.workspaceId}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();

  const kebab = page.getByTestId(`sidebar-workspace-kebab-${serverId}:${input.workspaceId}`);
  await expect(kebab).toBeVisible({ timeout: 10_000 });
  await kebab.click();

  const renameItem = page.getByTestId(
    `sidebar-workspace-menu-rename-${serverId}:${input.workspaceId}`,
  );
  await expect(renameItem).toBeVisible({ timeout: 10_000 });
  await renameItem.click();

  const modalPrefix = `sidebar-workspace-rename-modal-${serverId}:${input.workspaceId}`;
  const renameInput = page.getByTestId(`${modalPrefix}-input`);
  await expect(renameInput).toBeVisible({ timeout: 10_000 });
  await renameInput.fill(input.title);
  await page.getByTestId(`${modalPrefix}-submit`).click();
  await expect(renameInput).toHaveCount(0, { timeout: 15_000 });
}

test.describe("Current branch", () => {
  // The first test after a spec-file switch can fail while the shared daemon
  // releases stale sessions from the previous spec; one retry stabilizes it.
  test.describe.configure({ retries: 1 });

  test("Changes shows the current branch as read-only and follows external branch switches", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const serverId = getServerId();
    const workspace = await seedWorkspace({
      repoPrefix: "branch-coherence-",
      repo: { branches: ["main", "dev"] },
    });

    try {
      expect(workspace.workspaceName).toBe("main");

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: workspace.workspaceId });

      const customTitle = "Payments Refactor";
      await renameWorkspaceViaSidebar(page, {
        workspaceId: workspace.workspaceId,
        title: customTitle,
      });

      const headerTitle = page
        .getByTestId("workspace-header-title")
        .filter({ visible: true })
        .first();
      await expect(headerTitle).toHaveText(customTitle, { timeout: 30_000 });
      await expectNoBranchSwitcherInWorkspaceHeader(page);

      await openChangesPanel(page);
      await expectWorkspaceBranch(page, "main");
      const branchLabel = page
        .getByTestId("changes-current-branch")
        .filter({ visible: true })
        .first();
      await expect(page.getByTestId("changes-branch-switcher")).toHaveCount(0);
      await branchLabel.click();
      await expect(page.getByPlaceholder("Filter branches...")).toHaveCount(0);
      expect(
        (await readWorktreeBranchInfo({ worktreePath: workspace.repoPath })).currentBranch,
      ).toBe("main");
      await expect(
        page.getByTestId("changes-base-ref-switcher").filter({ visible: true }).first(),
      ).toBeEnabled();

      execFileSync("git", ["switch", "dev"], { cwd: workspace.repoPath, stdio: "pipe" });
      await expectWorkspaceBranch(page, "dev");

      await expect(headerTitle).toHaveText(customTitle, { timeout: 30_000 });
    } finally {
      await workspace.cleanup();
    }
  });
});
