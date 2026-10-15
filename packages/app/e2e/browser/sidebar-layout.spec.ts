import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import {
  closeMobileAgentSidebar,
  expectMobileAgentSidebarHidden,
  expectMobileAgentSidebarVisible,
  openMobileAgentSidebar,
} from "../support/helpers/sidebar";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";

async function replayPointerOut(target: Locator): Promise<void> {
  // Electron can emit pointerout with no related target while hovering portaled content.
  await target.evaluate((element) => {
    const { left, top, width, height } = element.getBoundingClientRect();
    const clientX = left + width / 2;
    const clientY = top + height / 2;
    const pointerTarget = document.elementFromPoint(clientX, clientY);
    if (!pointerTarget) throw new Error("Pointer target is missing");
    pointerTarget.dispatchEvent(
      new PointerEvent("pointerout", { bubbles: true, relatedTarget: null, clientX, clientY }),
    );
  });
}

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

async function expectSidebarSlide({
  page,
  action,
  opening,
}: {
  page: Page;
  action: () => Promise<void>;
  opening: boolean;
}) {
  const sampler = await page.evaluateHandle(() => {
    const sidebar = document.querySelector('[data-testid="left-sidebar"]');
    if (!sidebar) throw new Error("Sidebar is not mounted");
    const frames: number[] = [];
    let frameId: number;
    const sample = () => {
      const { x, width } = sidebar.getBoundingClientRect();
      if (width > 0 && x < -1 && x > 1 - width) frames.push(x);
      frameId = requestAnimationFrame(sample);
    };
    frameId = requestAnimationFrame(sample);
    return () => {
      cancelAnimationFrame(frameId);
      return frames;
    };
  });
  let frames: number[] = [];
  try {
    await action();
    const sidebar = page.getByTestId("left-sidebar");
    if (opening) {
      await expect(sidebar).toBeVisible();
      await expect.poll(async () => (await sidebar.boundingBox())?.x).toBe(0);
    } else {
      await expect(sidebar).toBeHidden();
    }
  } finally {
    frames = await sampler.evaluate((stop) => stop());
    await sampler.dispose();
  }
  expect(frames.length, "sidebar should paint intermediate slide positions").toBeGreaterThan(0);
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
    const surface = sidebar.locator("..");
    // CDP mouse input bypasses Electron's native drag-region hit-testing.
    await expect(surface).toHaveCSS("-webkit-app-region", "no-drag");
    await expect.poll(async () => (await surface.boundingBox())?.width).toBe(50);
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
      await expect(surface).toHaveCSS("-webkit-app-region", "no-drag");
      await expect.poll(async () => (await surface.boundingBox())?.width).toBe(420);
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

    await page.mouse.move(2, 300);
    await expect(sidebar).toBeVisible();
    await page.mouse.move(-10, 300);
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

test("a hover-revealed sidebar stays open across its workspace hover card", async ({ page }) => {
  const workspace = await seedWorkspace({ repoPrefix: "sidebar-hover-card-" });
  try {
    await gotoWorkspace(page, workspace.workspaceId);
    await waitForWorkspaceTabsVisible(page);
    const sidebar = page.getByTestId("left-sidebar");
    await page.getByTestId("menu-button").filter({ visible: true }).first().click();
    await page.mouse.move(600, 300);
    await expect(sidebar).toBeHidden();
    await page.mouse.move(2, 300);
    await expect(sidebar).toBeVisible();
    await expect.poll(async () => (await sidebar.boundingBox())?.x).toBe(0);
    const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`);
    await row.hover();
    const card = page.getByTestId("workspace-hover-card");
    await expect(card).toBeVisible();
    await expect
      .poll(() =>
        card.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const target = document.elementFromPoint(bounds.left + 2, bounds.top + 20);
          return element.contains(target);
        }),
      )
      .toBe(true);
    const rowBounds = await row.boundingBox();
    const cardBounds = await card.boundingBox();
    if (!rowBounds || !cardBounds) throw new Error("Workspace hover targets have no bounds");
    await page.mouse.move(cardBounds.x + 20, rowBounds.y + rowBounds.height / 2, { steps: 20 });
    await replayPointerOut(card);
    await page.waitForTimeout(250);
    await expect(sidebar).toBeVisible();
    await expect(card).toBeVisible();
    await row.hover();
    await expect(sidebar).toBeVisible();
    await page.mouse.move(900, 600);
    await expect(sidebar).toBeHidden();
  } finally {
    await workspace.cleanup();
  }
});

test("a hover-revealed sidebar stays open across its session tooltip", async ({ page }) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "sidebar-session-tooltip-",
    title: "Sidebar session tooltip",
    initialPrompt: "Reply with a short greeting",
    featureValues: { mockAssistantResponse: "A session preview outside the sidebar" },
  });
  try {
    await openAgentRoute(page, workspace);
    await waitForWorkspaceTabsVisible(page);
    const sidebar = page.getByTestId("left-sidebar");
    await page.getByTestId("menu-button").filter({ visible: true }).first().click();
    await page.mouse.move(900, 600);
    await expect(sidebar).toBeHidden();
    await page.mouse.move(2, 300);
    await expect(sidebar).toBeVisible();
    await expect.poll(async () => (await sidebar.boundingBox())?.x).toBe(0);
    const row = page.getByTestId(`sidebar-workspace-session-agent:${workspace.agentId}`);
    const tooltip = page.getByTestId(
      `sidebar-workspace-session-tooltip-agent:${workspace.agentId}`,
    );
    await row.hover();
    await expect(tooltip).toBeVisible();
    const sidebarBounds = await sidebar.boundingBox();
    const tooltipBounds = await tooltip.boundingBox();
    if (!sidebarBounds || !tooltipBounds) throw new Error("Session tooltip has no bounds");
    const x = Math.max(sidebarBounds.x + sidebarBounds.width + 20, tooltipBounds.x + 20);
    expect(x).toBeLessThan(tooltipBounds.x + tooltipBounds.width);
    await page.mouse.move(x, tooltipBounds.y + 20, { steps: 20 });
    await replayPointerOut(tooltip);
    await page.waitForTimeout(250);
    await expect(sidebar).toBeVisible();
    await expect(tooltip).toBeVisible();
    await page.mouse.move(x, tooltipBounds.y + tooltipBounds.height - 12, { steps: 10 });
    await expect(sidebar).toBeVisible();
    await expect(tooltip).toBeVisible();
    await row.hover();
    await expect(sidebar).toBeVisible();
    await page.mouse.move(900, 600);
    await expect(sidebar).toBeHidden();
    await expect(tooltip).toBeHidden();
  } finally {
    await workspace.cleanup();
  }
});

test("a hover-revealed sidebar stays open after its menu closes under the pointer", async ({
  page,
}) => {
  const workspace = await seedWorkspace({ repoPrefix: "sidebar-hover-menu-" });
  try {
    await gotoWorkspace(page, workspace.workspaceId);
    await waitForWorkspaceTabsVisible(page);
    const sidebar = page.getByTestId("left-sidebar");
    await page.getByTestId("menu-button").filter({ visible: true }).first().click();
    await page.mouse.move(600, 300);
    await expect(sidebar).toBeHidden();
    await page.mouse.move(2, 300);
    await expect(sidebar).toBeVisible();
    await expect.poll(async () => (await sidebar.boundingBox())?.x).toBe(0);
    const key = `${getServerId()}:${workspace.workspaceId}`;
    const row = page.getByTestId(`sidebar-workspace-row-${key}`);
    const copyPath = page.getByTestId(`sidebar-workspace-menu-copy-path-${key}`);
    for (const contextMenu of [false, true]) {
      for (const selectAction of [false, true]) {
        await row.hover();
        if (contextMenu) {
          await row.click({ button: "right", position: { x: 60, y: 10 } });
        } else {
          await page.getByTestId(`sidebar-workspace-kebab-${key}`).click();
        }
        await expect(copyPath).toBeVisible();
        if (selectAction) {
          await copyPath.click();
        } else {
          await page
            .getByRole("button", { name: "Menu backdrop", exact: true })
            .click({ position: { x: 100, y: 100 } });
        }
        await expect(copyPath).toBeHidden();
        await replayPointerOut(sidebar);
        await page.waitForTimeout(250);
        await expect(sidebar).toBeVisible();
      }
    }
    await page.mouse.move(900, 600);
    await expect(sidebar).toBeHidden();
  } finally {
    await workspace.cleanup();
  }
});

test("hover and the sidebar button slide open and closed", async ({ page }) => {
  const workspace = await seedWorkspace({ repoPrefix: "sidebar-motion-" });
  try {
    await gotoWorkspace(page, workspace.workspaceId);
    await waitForWorkspaceTabsVisible(page);
    const sidebar = page.getByTestId("left-sidebar");
    await expect.poll(async () => (await sidebar.boundingBox())?.x).toBe(0);
    const toggle = page.getByTestId("menu-button").filter({ visible: true }).first();

    await expectSidebarSlide({ page, action: () => toggle.click(), opening: false });
    await expectSidebarSlide({ page, action: () => page.mouse.move(25, 300), opening: true });
    await expectSidebarSlide({ page, action: () => page.mouse.move(600, 300), opening: false });
    await expectSidebarSlide({
      page,
      action: async () => {
        await toggle.focus();
        await page.keyboard.press("Enter");
      },
      opening: true,
    });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  } finally {
    await workspace.cleanup();
  }
});
