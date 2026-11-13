import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "../support/fixtures";
import { openChangesTreePanel } from "../support/helpers/workspace-tabs";

test("the diff mode menu explains when no commits are ahead of base", async ({
  page,
  withWorkspace,
}) => {
  const workspace = await withWorkspace({ prefix: "commit-range-empty-" });
  execFileSync("git", ["checkout", "-b", "feature"], { cwd: workspace.repoPath, stdio: "ignore" });
  await workspace.navigateTo();

  await openChangesTreePanel(page);
  await page.getByTestId("changes-diff-status-trigger").filter({ visible: true }).click();
  await expect(page.getByText("No commits ahead of main yet")).toBeVisible({ timeout: 30_000 });
});

test("a saved commit range shows only those commits' changes", async ({ page, withWorkspace }) => {
  const workspace = await withWorkspace({ prefix: "commit-range-picker-" });
  execFileSync("git", ["checkout", "-b", "feature"], { cwd: workspace.repoPath, stdio: "ignore" });
  for (const name of ["a", "b", "c"]) {
    await writeFile(path.join(workspace.repoPath, `${name}.txt`), `${name}\n`);
    execFileSync("git", ["add", `${name}.txt`], { cwd: workspace.repoPath, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", `Add ${name}`], {
      cwd: workspace.repoPath,
      stdio: "ignore",
    });
  }
  await workspace.navigateTo();

  await openChangesTreePanel(page);
  const tree = page.getByTestId("changes-tree-panel").filter({ visible: true });
  const trigger = tree.getByTestId("changes-diff-status-trigger");
  const row = (subject: string) =>
    page.locator('[data-testid^="commit-range-row-"]').filter({ hasText: subject });

  await trigger.click();
  await row("Add b").click({ timeout: 30_000 });
  await row("Add c").click();
  await page.getByTestId("commit-range-save").click();

  await expect(trigger).toContainText("2 commits");
  await expect(tree.getByText("c.txt", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(tree.getByText("b.txt", { exact: true })).toBeVisible();
  await expect(tree.getByText("a.txt", { exact: true })).toHaveCount(0);

  await trigger.click();
  await row("Add c").click();
  await page.getByTestId("commit-range-save").click();

  await expect(trigger).toContainText("Commit ");
  await expect(tree.getByText("c.txt", { exact: true })).toHaveCount(0, { timeout: 30_000 });
  await expect(tree.getByText("b.txt", { exact: true })).toBeVisible();
});
