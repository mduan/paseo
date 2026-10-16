import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import { createMockIdleAgent } from "../support/helpers/archive-tab";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";

function normalizedTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

async function openAgent(page: Page, agent: { id: string; workspaceId: string }): Promise<void> {
  await page.goto(buildHostAgentDetailRoute(getServerId(), agent.id, agent.workspaceId));
  await page.waitForURL(
    (url) => url.pathname.includes("/workspace/") && !url.searchParams.has("open"),
    { timeout: 60_000 },
  );
  await waitForWorkspaceTabsVisible(page);
}

async function openAgentTabTooltip(page: Page, agentId: string, title: string): Promise<Locator> {
  await page.getByRole("button", { name: normalizedTitle(title), exact: true }).hover();
  const tooltip = page.getByTestId(`workspace-tab-tooltip-agent_${agentId}`);
  await expect(tooltip).toBeVisible({ timeout: 10_000 });
  return tooltip;
}

async function expectAgentSummary(
  tooltip: Locator,
  input: { title: string; agentId: string },
): Promise<void> {
  const title = tooltip.getByText(normalizedTitle(input.title), { exact: true });
  const id = tooltip.getByText(input.agentId.slice(0, 7), { exact: true });
  const activity = tooltip.getByText(/^(just now|\d+[mhd] ago|[A-Z][a-z]{2} \d{1,2})$/);

  await expect(title).toBeVisible();
  const titleLayout = await title.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    fontSize: parseFloat(getComputedStyle(element).fontSize),
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(titleLayout.height).toBeGreaterThan(titleLayout.fontSize * 2);
  expect(titleLayout.scrollWidth).toBeLessThanOrEqual(titleLayout.width);
  expect(titleLayout.scrollHeight).toBeLessThanOrEqual(titleLayout.clientHeight);
  await expect(id).toBeVisible();
  await expect(tooltip.getByText("·", { exact: true })).toBeVisible();
  await expect(activity).toBeVisible();
  expect((await title.boundingBox())?.y).toBeLessThan((await id.boundingBox())?.y ?? 0);
}

test.describe("Workspace agent tab tooltip", () => {
  test("wraps the full agent title above its ID and last activity", async ({ page }) => {
    test.setTimeout(120_000);
    const workspace = await seedWorkspace({ repoPrefix: "workspace-agent-tooltip-" });

    try {
      const title = [
        "Short first line",
        "followed by a much longer continuation that should wrap across multiple lines so the complete title remains readable in the tooltip",
      ].join("\n");
      const agent = await createMockIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title,
      });

      await openAgent(page, agent);
      const tooltip = await openAgentTabTooltip(page, agent.id, title);

      await expectAgentSummary(tooltip, { title, agentId: agent.id });
    } finally {
      await workspace.cleanup();
    }
  });
});
