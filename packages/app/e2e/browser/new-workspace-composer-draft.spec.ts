import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";
import {
  expectNewWorkspaceDraft,
  expectNewWorkspaceProjectSelected,
  fillNewWorkspaceDraft,
  openGlobalNewWorkspaceComposer,
  openNewWorkspaceComposer,
  selectNewWorkspaceHost,
  selectNewWorkspaceProject,
} from "../support/helpers/new-workspace";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { seedSavedSettingsHosts } from "../support/helpers/settings";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { attachImageFromMenu, removeAttachmentPill } from "../support/helpers/composer";
import { projectPlacementViewKey } from "../support/helpers/project-view-key";

const DRAFT = `Please investigate the workspace startup failure.

Trace the request from the app through the daemon, preserve the existing behavior, and explain the root cause before making changes.`;

test.describe("New workspace composer draft", () => {
  test.describe.configure({ timeout: 240_000 });

  test("keeps the draft and its sidebar indicator when the project changes", async ({
    page,
  }, testInfo) => {
    const firstProject: SeededWorkspace = await seedWorkspace({
      repoPrefix: "new-workspace-draft-project-a-",
    });
    const secondProject: SeededWorkspace = await seedWorkspace({
      repoPrefix: "new-workspace-draft-project-b-",
    });
    const firstProjectViewKey = projectPlacementViewKey(getServerId(), firstProject.projectId);
    const secondProjectViewKey = projectPlacementViewKey(getServerId(), secondProject.projectId);

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openNewWorkspaceComposer(page, {
        projectKey: firstProject.projectKey,
        projectViewKey: firstProjectViewKey,
        projectDisplayName: firstProject.projectDisplayName,
      });
      await expectNewWorkspaceProjectSelected(page, firstProject.projectDisplayName);

      await fillNewWorkspaceDraft(page, DRAFT);
      const firstAction = page
        .getByTestId(`sidebar-project-new-worktree-${firstProjectViewKey}`)
        .first();
      await expect(firstAction).toHaveAttribute("aria-label", "Resume workspace draft");
      await page.getByRole("textbox", { name: "Message agent..." }).hover();
      await expect(firstAction).toHaveCSS("opacity", "1");

      await selectNewWorkspaceProject(page, {
        projectKey: secondProject.projectKey,
        projectViewKey: secondProjectViewKey,
        projectDisplayName: secondProject.projectDisplayName,
      });

      await expectNewWorkspaceDraft(page, DRAFT);
      const secondAction = page
        .getByTestId(`sidebar-project-new-worktree-${secondProjectViewKey}`)
        .first();
      await expect(secondAction).toHaveAttribute("aria-label", "Resume workspace draft");
      await expect(firstAction).not.toHaveAttribute("aria-label", "Resume workspace draft");
      await secondAction.hover();
      await expect(page.getByText("Resume workspace draft", { exact: true })).toBeVisible();
      await expect(
        page.getByTestId(`sidebar-project-kebab-${secondProjectViewKey}`).first(),
      ).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("workspace-draft-pencil-hover.png") });

      await page.getByTestId("sidebar-sessions").filter({ visible: true }).first().click();
      await expect(page).toHaveURL(/\/sessions(?:\?.*)?$/);
      await secondAction.click();
      await expectNewWorkspaceProjectSelected(page, secondProject.projectDisplayName);
      await expectNewWorkspaceDraft(page, DRAFT);

      await fillNewWorkspaceDraft(page, "");
      await expect(secondAction).not.toHaveAttribute("aria-label", "Resume workspace draft");
      await attachImageFromMenu(page, {
        name: "draft.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
      await expect(secondAction).toHaveAttribute("aria-label", "Resume workspace draft");
      await removeAttachmentPill(page, "composer-image-attachment-pill", "Remove image attachment");
      await expect(secondAction).not.toHaveAttribute("aria-label", "Resume workspace draft");
    } finally {
      await secondProject.cleanup();
      await firstProject.cleanup();
    }
  });

  test("keeps the draft when the host changes", async ({ page }) => {
    const project: SeededWorkspace = await seedWorkspace({
      repoPrefix: "new-workspace-draft-host-",
    });
    const secondaryServerId = "new-workspace-draft-secondary-host";

    try {
      await seedSavedSettingsHosts(page, [
        {
          serverId: getServerId(),
          label: "Primary host",
          endpoint: `127.0.0.1:${getE2EDaemonPort()}`,
        },
        {
          serverId: secondaryServerId,
          label: "Secondary host",
          endpoint: "127.0.0.1:9",
        },
      ]);

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openGlobalNewWorkspaceComposer(page);

      await fillNewWorkspaceDraft(page, DRAFT);
      await selectNewWorkspaceHost(page, "Secondary host");

      await expectNewWorkspaceDraft(page, DRAFT);
    } finally {
      await project.cleanup();
    }
  });

  test("does not restore a submitted draft after deferred publication", async ({ page }) => {
    const project = await seedWorkspace({ repoPrefix: "new-workspace-submitted-draft-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openNewWorkspaceComposer(page, {
        projectKey: project.projectKey,
        projectViewKey: projectPlacementViewKey(getServerId(), project.projectId),
        projectDisplayName: project.projectDisplayName,
      });

      const composer = page.getByRole("textbox", { name: "Message agent..." });
      const createButton = page.getByTestId("workspace-create-submit");
      await expect(composer).toBeEditable({ timeout: 30_000 });
      await expect(createButton).toBeEnabled({ timeout: 30_000 });

      await composer.evaluate((element, draft) => {
        if (!(element instanceof HTMLTextAreaElement)) {
          throw new Error("Composer input is not a textarea");
        }
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        if (!valueSetter) throw new Error("Textarea value setter is unavailable");
        valueSetter.call(element, draft);
        element.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            data: draft,
            inputType: "insertText",
          }),
        );
        const button = document.querySelector('[data-testid="workspace-create-submit"]');
        if (!(button instanceof HTMLElement)) {
          throw new Error("Create button is unavailable");
        }
        button.click();
      }, DRAFT);

      await page.waitForURL((url) => url.pathname.includes("/workspace/"), { timeout: 30_000 });
      await openGlobalNewWorkspaceComposer(page);
      await expectNewWorkspaceDraft(page, "");
    } finally {
      await project.cleanup();
    }
  });
});
