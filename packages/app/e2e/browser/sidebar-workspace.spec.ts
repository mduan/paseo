import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  closeMobileAgentSidebar,
  expectMobileAgentSidebarHidden,
  expectMobileAgentSidebarVisible,
  openMobileAgentSidebar,
  pinWorkspaceFromSidebar,
  collapseWorkspaceSessions,
} from "../support/helpers/sidebar";
import { seedWorkspace } from "../support/helpers/seed-client";
import { expectWorkspaceHeader } from "../support/helpers/workspace-ui";
import { getServerId } from "../support/helpers/server-id";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";
import { projectPlacementViewKey } from "../support/helpers/project-view-key";
import { escapeRegex } from "../support/helpers/regex";
import { openFilesPanel } from "../support/helpers/workspace-tabs";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { killProcessTree } from "../support/helpers/spawn-node";

const GITHUB_REMOTE_URL = "https://github.com/test-owner/test-repo.git";

function getWorkspaceRowTestId(workspaceId: string): string {
  return `sidebar-workspace-row-${getServerId()}:${workspaceId}`;
}

async function openWorkspaceFromSidebar(
  page: import("@playwright/test").Page,
  workspaceId: string,
) {
  const row = page.getByTestId(getWorkspaceRowTestId(workspaceId));
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page).toHaveURL(/\/workspace\//, { timeout: 30_000 });
  return row;
}

async function waitForSidebarProject(page: import("@playwright/test").Page, projectName: string) {
  const row = page
    .getByRole("button", {
      name: new RegExp(escapeRegex(projectName), "i"),
    })
    .first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

async function waitForSidebarWorkspace(page: import("@playwright/test").Page, workspaceId: string) {
  const row = page.getByTestId(getWorkspaceRowTestId(workspaceId));
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

async function openWorkspaceReadAction(
  page: import("@playwright/test").Page,
  workspaceId: string,
  action: "read" | "unread",
) {
  const workspaceKey = `${getServerId()}:${workspaceId}`;
  const row = await waitForSidebarWorkspace(page, workspaceId);
  await row.hover();
  await page.getByTestId(`sidebar-workspace-kebab-${workspaceKey}`).click();
  const item = page.getByTestId(`sidebar-workspace-menu-mark-as-${action}-${workspaceKey}`);
  await expect(item).toBeVisible({ timeout: 30_000 });
  return item;
}

async function openWorkspaceHoverCard(page: import("@playwright/test").Page, workspaceId: string) {
  const row = await waitForSidebarWorkspace(page, workspaceId);
  await row.hover();

  const hoverCard = page.getByRole("menu", { name: "Workspace scripts" });
  await expect(hoverCard).toBeVisible({ timeout: 30_000 });
  return hoverCard;
}

async function expectHoverPanelCloseDelay({
  page,
  card,
  source,
  panel,
}: {
  page: Page;
  card: Locator;
  source: Locator;
  panel: Locator;
}) {
  const time = Date.now();
  await page.clock.install({ time });
  await page.clock.pauseAt(time + 1_000);
  const otherRow = card.getByTestId("hover-card-workspace-host");
  await source.hover();
  await otherRow.hover();
  const bounds = await otherRow.boundingBox();
  if (!bounds) throw new Error("Host row has no bounds");

  for (let step = 0; step < 3; step++) {
    await page.mouse.move(bounds.x + step + 1, bounds.y + bounds.height / 2);
    await page.clock.runFor(100);
    await expect(panel).toHaveCount(step < 2 ? 1 : 0);
  }

  await source.hover();
  await otherRow.hover();
  await page.clock.runFor(250);
  await source.hover();
  await page.clock.runFor(600);
  await expect(panel).toBeVisible();

  await otherRow.hover();
  await page.clock.runFor(250);
  await panel.hover();
  await page.clock.runFor(600);
  await expect(panel).toBeVisible();

  await otherRow.hover();
  await page.clock.runFor(300);
  await expect(panel).toHaveCount(0);
  await page.clock.resume();
}

interface PaseoOwnedWorktree {
  projectName: string;
  workspaceId: string;
  worktreeSlug: string;
}

async function withPaseoOwnedWorktree(
  run: (workspace: PaseoOwnedWorktree) => Promise<void>,
): Promise<void> {
  const project = await seedWorkspace({ repoPrefix: "sidebar-hover-owned-worktree-" });
  const worktreeSlug = "hover-card-owned-worktree";

  try {
    const created = await project.client.createWorkspace({
      source: {
        kind: "worktree",
        cwd: project.repoPath,
        projectId: project.projectId,
        worktreeSlug,
      },
    });
    if (!created.workspace) {
      throw new Error(created.error ?? "Failed to create Paseo-owned worktree");
    }
    expect(path.basename(created.workspace.workspaceDirectory)).toBe(worktreeSlug);

    await run({
      projectName: path.basename(project.repoPath),
      workspaceId: created.workspace.id,
      worktreeSlug,
    });
  } finally {
    await project.cleanup();
  }
}

async function readCachedRowIds(
  page: Page,
  rowKind: "workspace" | "checkpoint",
): Promise<string[]> {
  return page.evaluate(
    async ({ serverId, kind }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("paseo-replica-row-store");
        request.addEventListener("success", () => resolve(request.result));
        request.addEventListener("error", () => reject(request.error));
      });
      try {
        return await new Promise<string[]>((resolve, reject) => {
          const transaction = database.transaction("rows", "readonly");
          const request = transaction.objectStore("rows").getAll();
          request.onsuccess = () =>
            resolve(
              request.result
                .filter(
                  (row: { serverId: string; kind: string }) =>
                    row.serverId === serverId && row.kind === kind,
                )
                .map((row: { id: string }) => row.id)
                .sort(),
            );
          request.addEventListener("error", () => reject(request.error));
        });
      } finally {
        database.close();
      }
    },
    { serverId: getServerId(), kind: rowKind },
  );
}

async function simulateDamagedLegacyDirectoryCache(
  page: Page,
  workspaceIdToRemove: string,
): Promise<void> {
  // Stop the app before altering storage so no pending app write can repair the fixture.
  const fixtureUrl = new URL("/__directory_cache_fixture", page.url()).href;
  await page.route(fixtureUrl, (route) =>
    route.fulfill({ contentType: "text/html", body: "<html><body>Cache fixture</body></html>" }),
  );
  await page.goto(fixtureUrl);
  await page.evaluate(
    async ({ serverId, missingWorkspaceId }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("paseo-replica-row-store");
        request.addEventListener("success", () => resolve(request.result));
        request.addEventListener("error", () => reject(request.error));
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction("rows", "readwrite");
          const store = transaction.objectStore("rows");
          const request = store.getAll();
          request.onsuccess = () => {
            const rows = request.result as Array<{
              serverId: string;
              kind: string;
              id: string;
              payload: string;
            }>;
            const checkpoint = rows.find(
              (row) => row.serverId === serverId && row.kind === "checkpoint",
            );
            if (!checkpoint) {
              transaction.abort();
              return;
            }
            const stored = JSON.parse(checkpoint.payload);
            // Accept either writer so this fixture also reproduces on the unfixed client.
            const cursors = stored.version === 1 ? stored.cursors : stored;
            if (!cursors.workspaces?.generation) {
              transaction.abort();
              return;
            }
            store.put({ ...checkpoint, payload: JSON.stringify(cursors) });
            for (const row of rows) {
              if (
                row.serverId === serverId &&
                row.kind === "workspace" &&
                row.id === missingWorkspaceId
              )
                store.delete([serverId, row.kind, row.id]);
            }
          };
          transaction.addEventListener("complete", () => resolve());
          transaction.addEventListener("abort", () =>
            reject(transaction.error ?? new Error("Missing current directory checkpoint")),
          );
          transaction.addEventListener("error", () => reject(transaction.error));
        });
      } finally {
        database.close();
      }
    },
    { serverId: getServerId(), missingWorkspaceId: workspaceIdToRemove },
  );
  expect(await readCachedRowIds(page, "workspace")).not.toContain(workspaceIdToRemove);
}

async function holdHostResponsesUntilCacheIsVisible(page: Page): Promise<() => void> {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.routeWebSocket(new RegExp(`:${getE2EDaemonPort()}(?:/|$)`), (socket) => {
    const server = socket.connectToServer();
    server.onMessage(async (message) => {
      await ready;
      socket.send(message);
    });
  });
  return release;
}

async function createPinnedSiblingWorkspace(
  project: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<string> {
  const sibling = await project.client.createWorkspace({
    source: { kind: "directory", path: project.repoPath, projectId: project.projectId },
    title: "Pinned sibling",
  });
  if (!sibling.workspace) throw new Error(sibling.error ?? "Sibling workspace was not created");
  await project.client.setWorkspacePinned(sibling.workspace.id, true);
  return sibling.workspace.id;
}

async function expectSidebarWorkspaces(page: Page, workspaceIds: string[]): Promise<void> {
  for (const workspaceId of workspaceIds) {
    await waitForSidebarWorkspace(page, workspaceId);
  }
}

async function cacheWorkspaces(page: Page, workspaceIds: string[]): Promise<void> {
  await gotoAppShell(page);
  await expectSidebarWorkspaces(page, workspaceIds);
  await expect.poll(() => readCachedRowIds(page, "workspace")).toEqual(workspaceIds);
}

async function reopenDamagedCacheBeforeHostResponds(
  page: Page,
  missingWorkspaceId: string,
): Promise<() => void> {
  await simulateDamagedLegacyDirectoryCache(page, missingWorkspaceId);
  const releaseHost = await holdHostResponsesUntilCacheIsVisible(page);
  await gotoAppShell(page);
  return releaseHost;
}

async function expectDamagedCacheHydrated(
  page: Page,
  retainedWorkspaceId: string,
  missingWorkspaceId: string,
): Promise<void> {
  await waitForSidebarWorkspace(page, retainedWorkspaceId);
  await expect(page.getByTestId(getWorkspaceRowTestId(missingWorkspaceId))).toHaveCount(0);
  await expect.poll(() => readCachedRowIds(page, "checkpoint")).toEqual([]);
}

async function expectRecoveredWorkspacesAfterReload(
  page: Page,
  workspaceIds: string[],
  testInfo: TestInfo,
): Promise<void> {
  await expectSidebarWorkspaces(page, workspaceIds);
  await expect.poll(() => readCachedRowIds(page, "workspace")).toEqual(workspaceIds);
  await page.reload();
  await expectSidebarWorkspaces(page, workspaceIds);
  await page.screenshot({ path: testInfo.outputPath("recovered-workspaces.png") });
  await testInfo.attach("recovered-workspaces", {
    path: testInfo.outputPath("recovered-workspaces.png"),
    contentType: "image/png",
  });
}

test.describe("Sidebar workspace list", () => {
  test("recovers missing workspaces from a damaged legacy cache after reload", async ({
    page,
  }, testInfo) => {
    const project = await seedWorkspace({ repoPrefix: "directory-cache-recovery-" });
    try {
      const siblingId = await createPinnedSiblingWorkspace(project);
      const ids = [project.workspaceId, siblingId].sort();
      await test.step("cache both workspaces", () => cacheWorkspaces(page, ids));

      const releaseHost = await test.step("reopen damaged cache before host responds", () =>
        reopenDamagedCacheBeforeHostResponds(page, project.workspaceId));
      await test.step("keep cached workspace and discard stale checkpoint", () =>
        expectDamagedCacheHydrated(page, siblingId, project.workspaceId));

      releaseHost();
      await test.step("recover missing workspace and retain both after reload", () =>
        expectRecoveredWorkspacesAfterReload(page, ids, testInfo));
    } finally {
      await project.cleanup();
    }
  });

  test("project with GitHub remote shows its selected folder name in sidebar", async ({ page }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "sidebar-remote-",
      repo: { withRemote: true, originUrl: GITHUB_REMOTE_URL },
    });

    try {
      const projectName = path.basename(workspace.repoPath);
      await gotoAppShell(page);
      await waitForSidebarProject(page, projectName);
      await waitForSidebarWorkspace(page, workspace.workspaceId);

      const projectRow = page
        .locator('[data-testid^="sidebar-project-row-"]')
        .filter({ hasText: projectName })
        .first();

      await expect(projectRow).toBeVisible({ timeout: 30_000 });
      await expect(projectRow).not.toContainText("test-owner/test-repo");
    } finally {
      await workspace.cleanup();
    }
  });

  test("project workspace count swaps with actions without moving the title", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-project-count-" });
    try {
      await gotoAppShell(page);
      const projectViewKey = projectPlacementViewKey(getServerId(), workspace.projectId);
      const row = page.getByTestId(`sidebar-project-row-${projectViewKey}`);
      const count = page.getByTestId(`sidebar-project-workspace-count-${projectViewKey}`);
      const title = row.getByText(path.basename(workspace.repoPath), { exact: true });
      await expect(row).toBeVisible();
      await page.mouse.move(900, 500);
      await expect(count).toHaveText("1");
      await expect(count).toHaveCSS("opacity", "1");
      const titleBounds = await title.boundingBox();
      const countBounds = await count.boundingBox();
      if (!titleBounds || !countBounds) throw new Error("Project title or count is missing");
      expect(countBounds.x).toBeGreaterThan(titleBounds.x + titleBounds.width);

      await row.hover();
      await expect(count).toHaveCSS("opacity", "0");
      expect(await title.boundingBox()).toEqual(titleBounds);
      await page.getByTestId(`sidebar-project-kebab-${projectViewKey}`).click();
      await page.mouse.move(900, 500);
      await expect(
        page.getByTestId(`sidebar-project-menu-open-settings-${projectViewKey}`),
      ).toBeVisible();
      await expect(count).toHaveCSS("opacity", "0");
      await page.keyboard.press("Escape");
      await expect(count).toHaveCSS("opacity", "1");
      expect(await title.boundingBox()).toEqual(titleBounds);
    } finally {
      await workspace.cleanup();
    }
  });

  test("non-git project shows directory name", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-directory-", git: false });

    try {
      await gotoAppShell(page);

      const directoryName = path.basename(workspace.repoPath);
      const projectRow = await waitForSidebarProject(page, directoryName);
      await expect(projectRow).toContainText(directoryName);
    } finally {
      await workspace.cleanup();
    }
  });

  test("workspace header uses the selected folder name instead of its GitHub remote", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "sidebar-header-",
      repo: { withRemote: true, originUrl: GITHUB_REMOTE_URL },
    });

    try {
      const projectName = path.basename(workspace.repoPath);
      await gotoAppShell(page);
      await waitForSidebarProject(page, projectName);
      await waitForSidebarWorkspace(page, workspace.workspaceId);
      await openWorkspaceFromSidebar(page, workspace.workspaceId);

      await expectWorkspaceHeader(page, {
        title: workspace.workspaceName,
        subtitle: projectName,
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("git project shows branch name in workspace row", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-branch-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarProject(page, path.basename(workspace.repoPath));

      expect(workspace.workspaceName).toBe("main");
      await expect(await waitForSidebarWorkspace(page, workspace.workspaceId)).toContainText(
        "main",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  test("workspace hover card shows host as metadata", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-hover-host-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarProject(page, path.basename(workspace.repoPath));

      const hoverCard = await openWorkspaceHoverCard(page, workspace.workspaceId);
      await expect(page.getByTestId("hover-card-workspace-host")).toHaveText("localhost");
      await expect(hoverCard).not.toContainText(/\b(Online|Connecting|Offline|Error|Idle)\b/);
    } finally {
      await workspace.cleanup();
    }
  });

  test("GitHub linkbacks do not show Linear issues without a Linear key", async ({ page }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "sidebar-linear-disconnected-",
      repo: {
        originUrl: "https://github.com/paseo-e2e/local-fixture.git",
        files: [
          {
            path: ".paseo-e2e-pr.json",
            content: JSON.stringify({
              title: "Fix warehouse metrics",
              comments: [
                {
                  author: { login: "linear-code" },
                  body: "<!-- linear-linkback -->[COR-1401 Fix](https://linear.app/acme/issue/COR-1401)",
                },
              ],
            }),
          },
        ],
      },
    });
    try {
      await gotoAppShell(page);
      const sidebarRow = await waitForSidebarWorkspace(page, workspace.workspaceId);
      await expect(
        sidebarRow.getByRole("link", { name: "Pull request #1, Open", exact: true }),
      ).toBeVisible();
      await expect(sidebarRow.getByTestId("sidebar-workspace-linear-issues")).toHaveCount(0);
      const card = await openWorkspaceHoverCard(page, workspace.workspaceId);
      await expect(card.getByTestId("hover-card-workspace-linear-issues")).toHaveCount(0);
    } finally {
      await workspace.cleanup();
    }
  });

  test("Linear issues show hover actions and two-second copy feedback", async ({
    page,
    context,
  }, testInfo) => {
    const workspace = await seedWorkspace({
      repoPrefix: "sidebar-linear-hover-",
    });
    try {
      const identifiers = [
        "COR-1401",
        "COR-1404",
        ...Array.from({ length: 10 }, (_, i) => `COR-${1500 + i}`),
      ];
      await workspace.client.updateWorkspaceLinearIssues({
        workspaceId: workspace.workspaceId,
        add: identifiers.map((identifier) => `https://linear.app/acme/issue/${identifier}`),
      });
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await gotoAppShell(page);
      const sidebarRow = await waitForSidebarWorkspace(page, workspace.workspaceId);
      await expect(sidebarRow.getByTestId("sidebar-workspace-linear-issues")).toBeVisible();
      const card = await openWorkspaceHoverCard(page, workspace.workspaceId);
      const source = card.getByTestId("hover-card-workspace-linear-issues");
      await expect(source).toContainText("COR-1401, COR-1404");
      await expect(source).toHaveCSS("cursor", "auto");
      await expect(source.getByRole("button")).toHaveCSS("cursor", "auto");
      await expect(source.getByRole("link", { name: "COR-1401", exact: true })).toHaveCSS(
        "cursor",
        "pointer",
      );
      await expect
        .soft(source.getByRole("link", { name: "COR-1401", exact: true }))
        .toHaveAttribute("href", "https://linear.app/acme/issue/COR-1401");
      await expect
        .soft(source.getByRole("link", { name: "COR-1404", exact: true }))
        .toHaveAttribute("href", "https://linear.app/acme/issue/COR-1404");
      const mainHeight = (await card.boundingBox())?.height;
      if (!mainHeight) throw new Error("Workspace tooltip has no height");
      await source.hover();
      const panel = card.getByTestId("hover-card-linear-panel");
      await expect(panel.getByText("Linear issues", { exact: true })).toBeVisible();
      const expandedHeight = (await card.boundingBox())?.height;
      expect.soft(expandedHeight).toBeLessThanOrEqual(mainHeight + 1);
      const row = panel.getByTestId("hover-card-linear-issue-COR-1401");
      await expect(row.getByRole("link")).toHaveCount(1);
      const copy = row.getByRole("button", { name: "Copy: COR-1401", exact: true });
      const actions = copy.locator("..");
      await expect(actions).toHaveCSS("opacity", "0");
      await row.hover();
      await expect(actions).toHaveCSS("opacity", "1");
      const screenshotPath = testInfo.outputPath("linear-issues.png");
      await card.screenshot({ path: screenshotPath });
      await testInfo.attach("Linear issue panel", {
        path: screenshotPath,
        contentType: "image/png",
      });
      await copy.click();
      await expect(
        row.getByRole("button", { name: "Copied: COR-1401", exact: true }),
      ).toBeVisible();
      await expect(copy).toBeVisible({ timeout: 4_000 });
      await panel.getByText("Linear issues", { exact: true }).hover();
      await expect(actions).toHaveCSS("opacity", "0");
      const lastIssue = panel.getByTestId("hover-card-linear-issue-COR-1509");
      await lastIssue.scrollIntoViewIfNeeded();
      await expect(lastIssue).toBeVisible();
      await expectHoverPanelCloseDelay({ page, card, source, panel });
      await page.getByTestId("sidebar-display-preferences-menu").click();
      await page.getByTestId("sidebar-display-show").click();
      await page.getByTestId("sidebar-row-item-linearIssues").click();
      await expect(sidebarRow.getByTestId("sidebar-workspace-linear-issues")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await sidebarRow.hover();
      await expect(source).toContainText("COR-1401, COR-1404");
    } finally {
      await workspace.cleanup();
    }
  });

  test("port hovercard excludes its whole surface from window dragging", async ({ page }) => {
    test.skip(process.platform === "win32", "Port discovery supports macOS and Linux");
    test.setTimeout(90_000);
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-port-hover-" });
    const listeners = spawn(
      process.execPath,
      [
        "-e",
        `const net = require('node:net');
         Promise.all([0, 1].map(() => new Promise(resolve => {
           net.createServer().listen(0, '127.0.0.1', resolve);
         }))).then(() => process.send('ready'));`,
      ],
      { cwd: workspace.repoPath, stdio: ["ignore", "ignore", "inherit", "ipc"] },
    );

    try {
      await once(listeners, "message");
      await gotoAppShell(page);
      const card = await openWorkspaceHoverCard(page, workspace.workspaceId);
      const ports = card.getByTestId("hover-card-workspace-ports");
      await expect(ports).toBeVisible({ timeout: 45_000 });
      await expect(ports).toHaveCSS("cursor", "auto");
      await ports.hover();
      const panel = card.getByTestId("hover-card-ports-panel");
      const rows = panel.locator(":scope > div").filter({ has: page.getByRole("button") });
      await expect(rows).toHaveCount(2);
      const actions = panel.getByRole("button").locator("..");

      await expect(card).toHaveCSS("-webkit-app-region", "no-drag");
      for (const index of [0, 1, 0]) {
        const current = rows.nth(index);
        const bounds = await current.boundingBox();
        if (!bounds) throw new Error("Port row has no bounds");
        for (const position of [
          { x: 1, y: 1 },
          { x: bounds.width / 2, y: bounds.height / 2 },
          { x: bounds.width - 1, y: bounds.height - 1 },
        ]) {
          await current.hover({ position });
          await expect(actions.nth(index)).toHaveCSS("opacity", "1");
          await expect(actions.nth(1 - index)).toHaveCSS("opacity", "0");
        }
      }

      await panel.getByText("Live ports", { exact: true }).hover();
      await expect(actions.nth(0)).toHaveCSS("opacity", "0");
      await expect(actions.nth(1)).toHaveCSS("opacity", "0");
      await expectHoverPanelCloseDelay({ page, card, source: ports, panel });
    } finally {
      await killProcessTree(listeners);
      await workspace.cleanup();
    }
  });

  test("marks a finished workspace unread until it is opened again", async ({ page }) => {
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "sidebar-mark-unread-",
      title: "Mark unread",
      initialPrompt: "Finish this test turn.",
    });

    try {
      await workspace.client.waitForFinish(workspace.agentId, 20_000);
      await workspace.client.clearWorkspaceAttention(workspace.workspaceId);
      expect(workspace.client.getLastServerInfoMessage()?.features?.workspaceMarkUnread).toBe(true);
      await gotoAppShell(page);

      const row = await waitForSidebarWorkspace(page, workspace.workspaceId);
      await collapseWorkspaceSessions(page, workspace.workspaceId);
      await expect(row.getByTestId("workspace-status-indicator-done")).toBeVisible();
      await (await openWorkspaceReadAction(page, workspace.workspaceId, "unread")).click();
      await openWorkspaceReadAction(page, workspace.workspaceId, "read");

      await page.keyboard.press("Escape");
      await openWorkspaceFromSidebar(page, workspace.workspaceId);
      await openWorkspaceReadAction(page, workspace.workspaceId, "unread");
    } finally {
      await workspace.cleanup();
    }
  });

  test("Paseo-owned worktree hover card shows the worktree directory name", async ({ page }) => {
    await withPaseoOwnedWorktree(async ({ projectName, workspaceId, worktreeSlug }) => {
      await gotoAppShell(page);
      await waitForSidebarProject(page, projectName);
      await openWorkspaceHoverCard(page, workspaceId);

      await expect(page.getByTestId("hover-card-workspace-cwd")).toHaveText(worktreeSlug);
    });
  });
});

test.describe("Mobile sidebar panelState transition", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("showMobileAgent open and close transition", async ({ page }) => {
    await gotoAppShell(page);
    await expectMobileAgentSidebarHidden(page);
    await openMobileAgentSidebar(page);
    await expectMobileAgentSidebarVisible(page);
    await closeMobileAgentSidebar(page);
    await expectMobileAgentSidebarHidden(page);
  });

  test("keeps a pinned workspace rendered while the retained sidebar is closed", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-retained-pin-" });

    try {
      await gotoAppShell(page);
      await openMobileAgentSidebar(page);
      await expectMobileAgentSidebarVisible(page);

      const row = page.getByTestId(getWorkspaceRowTestId(workspace.workspaceId));
      await expect(row).toBeVisible({ timeout: 30_000 });
      await pinWorkspaceFromSidebar(page, workspace.workspaceId);
      await expect(page.getByTestId("sidebar-pinned-section")).toBeVisible();

      await closeMobileAgentSidebar(page);
      await expectMobileAgentSidebarHidden(page);

      await expect(row).toHaveCount(1);
    } finally {
      await workspace.cleanup();
    }
  });
});

test.describe("Half-screen desktop layout", () => {
  test.use({ viewport: { width: 751, height: 982 } });

  test("keeps the sidebar scroll position across close and reopen", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-retained-scroll-" });

    try {
      let lastWorkspaceId = workspace.workspaceId;
      for (let index = 0; index < 24; index += 1) {
        const created = await workspace.client.createWorkspace({
          source: {
            kind: "directory",
            path: workspace.repoPath,
            projectId: workspace.projectId,
          },
          title: `Retained sidebar ${index + 1}`,
        });
        if (!created.workspace) {
          throw new Error(created.error ?? "Failed to fill the retained sidebar");
        }
        lastWorkspaceId = created.workspace.id;
      }

      await gotoAppShell(page);
      await page.getByTestId(`sidebar-project-show-more-${workspace.projectViewKey}`).click();
      await waitForSidebarWorkspace(page, lastWorkspaceId);

      const sidebarScroll = page.getByTestId("sidebar-project-workspace-list-scroll");
      const scrollTop = await sidebarScroll.evaluate((element) => {
        element.scrollTop = 160;
        return element.scrollTop;
      });
      expect(scrollTop).toBe(160);

      const sidebarToggle = page.getByTestId("composer-dock-header").getByTestId("menu-button");
      await sidebarToggle.click();
      await expect(page.getByTestId("sidebar-global-new-workspace")).not.toBeVisible();

      await page.mouse.move(600, 300);
      await page.mouse.move(2, 300);
      const sidebar = page.getByTestId("left-sidebar");
      await expect(sidebar).toBeVisible();
      await sidebar.getByTestId("menu-button").click();
      await expect(page.getByTestId("sidebar-global-new-workspace")).toBeVisible();
      await expect(sidebarScroll).toHaveJSProperty("scrollTop", scrollTop);
    } finally {
      await workspace.cleanup();
    }
  });

  test("keeps the pinned sidebar at half of a 14-inch Mac display", async ({ page }) => {
    await gotoAppShell(page);
    await expect(page.getByTestId("sidebar-global-new-workspace")).toBeVisible();
    await expect(page.getByTestId("agent-list-backdrop")).not.toBeVisible();
  });

  test("keeps the left toggle center-owned without left window controls", async ({ page }) => {
    await gotoAppShell(page);

    const openToggle = page.getByTestId("menu-button");
    const openIcon = openToggle.locator("svg").first();
    await expect(openIcon).toBeVisible();
    const openBounds = await openIcon.boundingBox();
    expect(openBounds).not.toBeNull();
    expect(openBounds?.x).toBeGreaterThan(12);

    await openToggle.click();
    await expect(page.getByTestId("sidebar-global-new-workspace")).not.toBeVisible();

    const closedToggle = page.getByTestId("menu-button");
    const closedIcon = closedToggle.locator("svg").first();
    await expect(closedIcon).toBeVisible();
    const closedBounds = await closedIcon.boundingBox();
    expect(closedBounds).not.toBeNull();
    expect(closedBounds?.x).toBeCloseTo(9, 0);
    expect(closedBounds?.y).toBe(openBounds?.y);
  });

  test("yields app navigation to the settings split", async ({ page }) => {
    await gotoAppShell(page);
    await page.getByTestId("sidebar-settings").click();

    await expect(page.getByTestId("settings-sidebar")).toBeVisible();
    await expect(page.getByTestId("settings-detail-pane")).toBeVisible();
    await expect(page.getByTestId("sidebar-settings")).not.toBeVisible();
  });

  test("keeps app navigation beside the Explorer pane", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-half-screen-explorer-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarProject(page, path.basename(workspace.repoPath));
      await openWorkspaceFromSidebar(page, workspace.workspaceId);

      await openFilesPanel(page);
      const explorerToggle = page.getByTestId("workspace-explorer-toggle").first();
      await expect(
        page.getByTestId("explorer-sidebar-tab-files").filter({ visible: true }),
      ).toBeVisible();
      await expect(explorerToggle).toHaveAccessibleName("Close Explorer sidebar");
      await expect(page.getByTestId("sidebar-global-new-workspace")).toBeVisible();
      await expect(page.getByTestId("explorer-sidebar-tab-rail")).toBeVisible();
      await expect(page.getByTestId("workspace-tabs-row").filter({ visible: true })).toHaveCount(1);

      await explorerToggle.click();
      await expect(
        page.getByTestId("explorer-sidebar-tab-files").filter({ visible: true }),
      ).toHaveCount(0);
      await expect(explorerToggle).toHaveAccessibleName("Open Explorer sidebar");
      await expect(page.getByTestId("sidebar-global-new-workspace")).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });
});
