import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { projectPlacementViewKey } from "../support/helpers/project-view-key";
import { connectSeedClient } from "../support/helpers/seed-client";

interface SeededProject {
  projectViewKey: string;
  cleanup(): Promise<void>;
}

/**
 * Adds a project whose directory name ends in a space, which `seedWorkspace`
 * cannot produce because `mkdtemp` appends the random suffix. The project is
 * owned until `cleanup`, which removes the daemon record before the directory.
 */
async function seedProjectNamedWithTrailingSpace(): Promise<SeededProject> {
  const parentDirectory = await mkdtemp(path.join(tmpdir(), "paseo-e2e-trailing-space-"));
  const directoryPath = path.join(parentDirectory, `Reklamation-${randomUUID().slice(0, 8)} `);
  await mkdir(directoryPath);
  await writeFile(path.join(directoryPath, "README.md"), "# Trailing space\n");

  const client = await connectSeedClient();
  const removeParentDirectory = () => rm(parentDirectory, { recursive: true, force: true });
  try {
    const added = await client.addProject(directoryPath);
    expect(added.error).toBeNull();
    expect(added.project?.projectRootPath).toBe(directoryPath);
    const project = added.project;
    if (!project?.projectKey) {
      throw new Error(`The daemon added ${directoryPath} without a project key`);
    }
    return {
      projectViewKey: projectPlacementViewKey(
        client.getLastServerInfoMessage()!.serverId,
        project.projectId,
      ),
      cleanup: async () => {
        await client.removeProject(project.projectId).catch(() => undefined);
        await client.close().catch(() => undefined);
        await removeParentDirectory().catch(() => undefined);
      },
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    await removeParentDirectory().catch(() => undefined);
    throw error;
  }
}

async function expectProjectRow(page: Page, projectViewKey: string): Promise<void> {
  const row = page.getByTestId(`sidebar-project-row-${projectViewKey}`);
  await expect(row).toBeVisible({ timeout: 60_000 });
}

async function expectAppShellRendered(page: Page): Promise<void> {
  await expect(page.getByText("Paseo ran into a problem.")).toHaveCount(0);
}

// Regression for trailing whitespace causing repeated sidebar order reconciliation (#4880).
test("a project whose folder name ends in a space renders in the sidebar", async ({ page }) => {
  const project = await seedProjectNamedWithTrailingSpace();

  try {
    await gotoAppShell(page);

    await expectProjectRow(page, project.projectViewKey);
    await expectAppShellRendered(page);
  } finally {
    await project.cleanup();
  }
});
