import { expect, type Page } from "@playwright/test";
import { openChangesTreePanel } from "./workspace-tabs";

export async function openChangesPanel(page: Page): Promise<void> {
  await openChangesTreePanel(page);
  await expect(
    page.getByTestId("changes-repository-header").filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 30_000 });
}

export async function expectWorkspaceBranch(page: Page, branchName: string): Promise<void> {
  await expect(
    page.getByTestId("changes-current-branch").filter({ visible: true }).first(),
  ).toHaveText(branchName, { timeout: 30_000 });
}

export async function expectNoBranchSwitcherInWorkspaceHeader(page: Page): Promise<void> {
  await expect(page.getByTestId("workspace-header-branch-switcher")).toHaveCount(0);
}
