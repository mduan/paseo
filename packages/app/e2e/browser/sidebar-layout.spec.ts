import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  closeMobileAgentSidebar,
  expectMobileAgentSidebarHidden,
  expectMobileAgentSidebarVisible,
  openMobileAgentSidebar,
} from "../support/helpers/sidebar";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";

async function dragSidebarTo(page: Page, width: number) {
  const handle = page.getByTestId("left-sidebar-resize-handle");
  const bounds = await handle.boundingBox();
  const sidebarBounds = await page.getByTestId("left-sidebar").boundingBox();
  if (!bounds || !sidebarBounds) throw new Error("Sidebar resize handle has no bounds");
  const startX = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  // Activate the pan before measuring the requested width.
  await page.mouse.move(startX - 10, y);
  await page.mouse.move(startX - 20, y);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const x = startX + width - sidebarBounds.width - 20;
  await page.mouse.move(x, y, { steps: 15 });
}

test("a collapsed sidebar slides over content and dismisses when the mouse leaves", async ({
  page,
}, testInfo) => {
  const workspace = await seedWorkspace({ repoPrefix: "sidebar-edge-" });
  try {
    await gotoWorkspace(page, workspace.workspaceId);
    await waitForWorkspaceTabsVisible(page);
    const sidebar = page.getByTestId("left-sidebar");
    await dragSidebarTo(page, 420);
    await page.mouse.up();
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(420);
    const retainedSidebar = await sidebar.elementHandle();
    await page.getByTestId("menu-button").filter({ visible: true }).first().click();
    await page.mouse.move(600, 300);
    await expect(sidebar).toBeHidden();
    const tabs = page.getByTestId("workspace-tabs-row").filter({ visible: true }).first();
    const contentBounds = await tabs.boundingBox();

    await page.mouse.move(51, 300);
    await expect(sidebar).toBeHidden();
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("App viewport is not available");
    for (const y of [2, viewport.height / 2, viewport.height - 10]) {
      await page.mouse.move(49, y);
      await page.mouse.move(400, y);
      await expect(sidebar).toBeVisible();
      await expect.poll(async () => (await sidebar.boundingBox())?.x).toBe(0);
      await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(420);
      await expect.poll(async () => (await sidebar.boundingBox())?.height).toBe(viewport.height);
      await page.mouse.move(600, y);
      await expect(sidebar).toBeHidden();
    }
    await page.mouse.move(49, 300);
    await expect(sidebar).toBeVisible();
    await expect.poll(async () => (await sidebar.boundingBox())?.x).toBe(0);
    expect(
      await sidebar.evaluate((element, original) => element === original, retainedSidebar),
    ).toBe(true);
    expect(await tabs.boundingBox()).toEqual(contentBounds);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("panel-state")))
      .toContain('"agentListOpen":false');

    const sidebarBounds = await sidebar.boundingBox();
    if (!sidebarBounds) throw new Error("Revealed sidebar has no bounds");
    await page.mouse.move(sidebarBounds.width / 2, 300);
    await expect(sidebar).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("sidebar-edge-reveal.png") });
    await page.mouse.move(sidebarBounds.width + 30, 300);
    await expect(sidebar).toBeHidden();

    await page.mouse.move(2, 300);
    await expect(sidebar).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(sidebar).toBeHidden();

    await test.step("the edge and revealed controls sit above embedded pages", async () => {
      await page.evaluate(() => {
        const frame = document.createElement("iframe");
        frame.title = "Embedded page";
        frame.srcdoc = "<body>Embedded content</body>";
        Object.assign(frame.style, {
          position: "fixed",
          inset: "0",
          width: "100%",
          height: "100%",
          border: "0",
          zIndex: "0",
        });
        document.body.appendChild(frame);
      });
      await page.getByTitle("Embedded page").hover({ position: { x: 600, y: 300 } });
      await page.mouse.move(2, 300);
      await expect(sidebar).toBeVisible();
      await sidebar.getByTestId("sidebar-help").click();
      await expect(page.getByTestId("sidebar-help-menu")).toBeVisible();
      await page.keyboard.press("Escape");
      await page.mouse.move(600, 300);
      await expect(sidebar).toBeHidden();
      await page.getByTitle("Embedded page").evaluate((element) => element.remove());
    });

    await page.mouse.move(2, 300);
    await expect(sidebar).toBeVisible();
    await sidebar.getByTestId("menu-button").click();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("panel-state")))
      .toContain('"agentListOpen":true');
    expect(
      await sidebar.evaluate((element, original) => element === original, retainedSidebar),
    ).toBe(true);
  } finally {
    await workspace.cleanup();
  }
});

test("compact layouts keep the explicit sidebar toggle", async ({ page }) => {
  const workspace = await seedWorkspace({ repoPrefix: "sidebar-compact-" });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWorkspace(page, workspace.workspaceId);
    await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
    await page.mouse.move(2, 300);
    await expectMobileAgentSidebarHidden(page);
    await expect(page.getByTestId("sidebar-edge-trigger")).toHaveCount(0);
    await openMobileAgentSidebar(page);
    await expectMobileAgentSidebarVisible(page);
    await closeMobileAgentSidebar(page);
    await expectMobileAgentSidebarHidden(page);
  } finally {
    await workspace.cleanup();
  }
});
