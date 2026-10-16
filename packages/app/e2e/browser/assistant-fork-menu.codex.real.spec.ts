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
