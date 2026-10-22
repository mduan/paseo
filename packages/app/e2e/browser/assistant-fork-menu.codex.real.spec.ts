import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import { openMostRecentAssistantForkMenu } from "../support/helpers/assistant-fork";
import { composerLocator } from "../support/helpers/composer";
import { pressNewTabShortcut } from "../support/helpers/launcher";
import {
  cleanupRewindFlow,
  launchAgent,
  sendMessage,
  type AgentHandle,
} from "../support/helpers/rewind-flow";
import { getServerId } from "../support/helpers/server-id";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";
import { seedSavedSettingsHosts } from "../support/helpers/settings";

test("full-history forks reuse the workspace and keep slash commands onscreen", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "paseo-fork-navigation-")));
  let handle: AgentHandle | undefined;
  try {
    handle = await launchAgent({
      page,
      provider: "codex",
      cwd,
      mode: "full-access",
      providerConfig: { model: "gpt-6.1-sol" },
    });
    await sendMessage(
      handle,
      "Reply with exactly FORK_READY. Do not use tools or change any files.",
    );
    const workspace = page.getByTestId(
      `workspace-deck-entry-${getServerId()}:${handle.workspaceId}`,
    );
    const originalElement = await workspace.elementHandle();
    await openMostRecentAssistantForkMenu(page);
    await page.getByRole("menuitem", { name: "Fork in a new tab", exact: true }).click();
    await expect(page.getByTestId("fork-marker").filter({ visible: true })).toBeVisible({
      timeout: 60_000,
    });
    await expect(workspace).toHaveCount(1);
    expect(await originalElement?.evaluate((element) => element.isConnected)).toBe(true);
    const input = composerLocator(page);
    await input.fill("/");
    await expect(
      page.getByTestId("composer-autocomplete-popover").filter({ visible: true }),
    ).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath("fork-slash-menu.png") });
    await input.fill("");
    await pressNewTabShortcut(page);
    await expect(page.getByTestId("workspace-new-tab-panel")).toBeVisible();
    await expect(workspace).toHaveCount(1);
  } finally {
    await cleanupRewindFlow({ handle, cwd });
  }
});

test("full-history workspace forks keep the source host visible and disabled", async ({ page }) => {
  test.setTimeout(300_000);
  await seedSavedSettingsHosts(page, [
    {
      serverId: getServerId(),
      label: "Source host",
      endpoint: `127.0.0.1:${getE2EDaemonPort()}`,
    },
    {
      serverId: "secondary-full-history-fork-host",
      label: "Other host",
      endpoint: "127.0.0.1:9",
    },
  ]);
  const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "paseo-fork-host-")));
  let handle: AgentHandle | undefined;
  try {
    handle = await launchAgent({
      page,
      provider: "codex",
      cwd,
      mode: "full-access",
      providerConfig: { model: "gpt-6.1-sol" },
    });
    await sendMessage(
      handle,
      "Reply with exactly FORK_READY. Do not use tools or change any files.",
    );
    await openMostRecentAssistantForkMenu(page);
    await page.getByRole("menuitem", { name: "Fork in a new workspace", exact: true }).click();

    await expect(page).toHaveURL(/\/new\?.*draftId=/);
    const host = page.getByTestId("host-picker-trigger");
    await expect(host).toBeVisible();
    await expect(host).toContainText("Source host");
    await expect(host).toBeDisabled();
    await expect(host).toHaveCSS("opacity", "0.6");
    await host.hover();
    await expect(page.getByText("Full-history forks stay on their original host.")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("fork-host-disabled-desktop.png") });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(host).toBeVisible();
    await expect(host).toContainText("Source host");
    await expect(host).toBeDisabled();
    await page.screenshot({ path: test.info().outputPath("fork-host-disabled-compact.png") });
  } finally {
    await cleanupRewindFlow({ handle, cwd });
  }
});
