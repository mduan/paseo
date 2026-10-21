import { expect, type Locator, type Page } from "@playwright/test";
import { gotoAppShell } from "./app";
import { addConnectedHostsAndReload, waitForConnectedHost } from "./hosts";
import { openProjectSettings } from "./project-settings";
import { selectSettingsHost } from "./settings";
import { waitForSidebarHydration } from "./workspace-ui";
import { buildProjectsSettingsRoute } from "@/utils/host-routes";

const PROJECT_VISIBILITY_TIMEOUT = 30_000;

// eslint-disable-next-line typescript/consistent-type-definitions -- Workspace instructions require type aliases.
type ProjectWorkspace = { projectName: string; workspaceName: string };

function projectGroup(page: Page, projectName: string): Locator {
  return page.getByRole("group", { name: projectName, exact: true });
}

function projectGroupWithWorkspace(
  page: Page,
  projectName: string,
  workspaceName: string,
): Locator {
  return projectGroup(page, projectName).filter({ hasText: workspaceName });
}

export async function openProjectDirectory(page: Page): Promise<void> {
  await gotoAppShell(page);
  await waitForSidebarHydration(page);
}

export async function openProjectDirectoryWithHosts(
  page: Page,
  input: {
    hosts: Array<{ serverId: string; label: string; port: number }>;
    primaryLabel?: string;
  },
): Promise<void> {
  await gotoAppShell(page);
  await addConnectedHostsAndReload(page, input.hosts, { primaryLabel: input.primaryLabel });
  for (const host of input.hosts) {
    await waitForConnectedHost(page, {
      serverId: host.serverId,
      endpoint: `localhost:${host.port}`,
    });
  }
  await waitForSidebarHydration(page);
}

export async function expectSeparateProjects(
  page: Page,
  projects: ProjectWorkspace[],
): Promise<void> {
  for (const project of projects) {
    const group = projectGroupWithWorkspace(page, project.projectName, project.workspaceName);
    await expect(group).toHaveCount(1, { timeout: PROJECT_VISIBILITY_TIMEOUT });
    for (const other of projects.filter((candidate) => candidate !== project)) {
      await expect(
        group
          .locator('[data-testid^="sidebar-workspace-row-"]')
          .filter({ hasText: other.workspaceName }),
      ).toHaveCount(0);
    }
  }
}

export async function beginWorkspaceFromProject(
  page: Page,
  input: ProjectWorkspace,
): Promise<void> {
  const { projectName, workspaceName } = input;
  const group = projectGroupWithWorkspace(page, projectName, workspaceName);
  await expect(group).toBeVisible({ timeout: PROJECT_VISIBILITY_TIMEOUT });
  await group.hover();
  await group.getByLabel(`Create a new workspace for ${projectName}`).click();
  await expect(page.getByRole("button", { name: "Workspace project", exact: true })).toContainText(
    projectName,
    { timeout: PROJECT_VISIBILITY_TIMEOUT },
  );
}

export async function selectWorkspaceHost(page: Page, hostName: string): Promise<void> {
  await page.getByRole("button", { name: "Host", exact: true }).click();
  await page.getByRole("button", { name: hostName, exact: true }).click();
  await expect(page.getByRole("button", { name: "Host", exact: true })).toContainText(hostName);
}

export async function createWorkspaceWithoutAgent(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Create", exact: true }).click();
}

export async function expectProjectWorkspaceCountForHost(
  page: Page,
  input: { projectName: string; hostName: string; count: number },
): Promise<void> {
  const group = projectGroup(page, input.projectName).filter({ hasText: input.hostName });
  await expect(group.locator('[data-testid^="sidebar-workspace-row-"]')).toHaveCount(input.count, {
    timeout: PROJECT_VISIBILITY_TIMEOUT,
  });
}

export async function renameProject(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await page.getByRole("textbox", { name: "Project name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Project updated", { exact: true })).toBeVisible({
    timeout: PROJECT_VISIBILITY_TIMEOUT,
  });
}

export async function openGroupedProjectSettings(
  page: Page,
  input: { serverId: string; projectName: string },
): Promise<void> {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await selectSettingsHost(page, input.serverId);
  await page.locator('[data-testid="settings-host-section-projects"]:visible').click();
  await expect(page).toHaveURL(/\/settings\/hosts\/[^/]+\/projects$/);
  await openProjectSettings(page, input.projectName);
}

export async function openProjectsForSettingsHost(
  page: Page,
  input: { serverId: string; projectName: string },
): Promise<void> {
  await selectSettingsHost(page, input.serverId);
  await expect(page).toHaveURL(buildProjectsSettingsRoute(input.serverId));
  await openProjectSettings(page, input.projectName);
}

export async function expectProjectSettingsName(page: Page, projectName: string): Promise<void> {
  await expect(page.getByRole("main").getByText(projectName, { exact: true })).toBeVisible({
    timeout: PROJECT_VISIBILITY_TIMEOUT,
  });
}
