import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import { connectNewWorkspaceDaemonClient } from "../support/helpers/new-workspace";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import {
  expectSettingsHeader,
  openHostSection,
  openSettingsHost,
} from "../support/helpers/settings";

async function openMetadataGenerationSettings(page: Page) {
  const serverId = getServerId();
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHost(page, serverId);
  await openHostSection(page, serverId, "metadata");
  await expectSettingsHeader(page, "Metadata");
}

async function openManualMetadataModelPicker(page: Page) {
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  await page.getByRole("button", { name: /Select model/ }).click();
}

test("chooses a metadata model and can return to automatic selection", async ({
  page,
}, testInfo) => {
  await openMetadataGenerationSettings(page);

  // The section explains itself through the header's info tooltip, not a paragraph.
  await expect(page.getByTestId("metadata-generation-settings-info")).toHaveAccessibleName(
    "About Metadata generation",
  );
  await expect(page.getByRole("button", { name: "Automatic", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.screenshot({
    path: testInfo.outputPath("metadata-automatic.png"),
    fullPage: true,
  });

  await openManualMetadataModelPicker(page);
  await page.getByText("Mock Load Test", { exact: true }).click();
  await expect(page.getByText("Ten second stream", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("metadata-model-picker.png"),
    fullPage: true,
  });
  await page.getByText("Ten second stream", { exact: true }).click();

  await expect(page.getByRole("button", { name: /Ten second stream/ })).toBeVisible();
  const effort = page.getByTestId("metadata-generation-effort");
  await expect(effort).toHaveText("Low");
  await effort.click();
  await page.getByRole("menuitem", { name: "High", exact: true }).click();
  await expect(effort).toHaveText("High");
  await page.reload();
  await expect(page.getByRole("button", { name: "Manual", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("button", { name: /Ten second stream/ })).toBeVisible();
  await expect(effort).toHaveText("High");
  await page.screenshot({
    path: testInfo.outputPath("metadata-manual-persisted.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Automatic", exact: true }).click();
  await page.reload();

  await expect(page.getByRole("button", { name: "Automatic", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("button", { name: /Ten second stream/ })).toHaveCount(0);
  await expect(effort).toHaveCount(0);
});

test("updates model-dependent effort and preserves metadata fallbacks", async ({ page }) => {
  const client = await connectNewWorkspaceDaemonClient({ ownProjects: false });
  const previousConfig = await client.getDaemonConfig();

  try {
    await client.patchDaemonConfig({
      metadataGeneration: {
        providers: [
          { provider: "mock", model: "five-minute-stream", thinkingOptionId: "high" },
          { provider: "mock", model: "thirty-minute-stream", thinkingOptionId: "medium" },
        ],
      },
    });
    await openMetadataGenerationSettings(page);

    await expect(page.getByRole("button", { name: "Manual", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const effort = page.getByTestId("metadata-generation-effort");
    await expect(effort).toHaveText("High");
    await openManualMetadataModelPicker(page);
    await page.getByText("Ten second stream", { exact: true }).click();

    await expect
      .poll(async () => (await client.getDaemonConfig()).config.metadataGeneration.providers)
      .toEqual([
        { provider: "mock", model: "ten-second-stream", thinkingOptionId: "low" },
        { provider: "mock", model: "thirty-minute-stream", thinkingOptionId: "medium" },
      ]);
    await effort.click();
    await page.getByRole("menuitem", { name: "High", exact: true }).click();
    await expect
      .poll(async () => (await client.getDaemonConfig()).config.metadataGeneration.providers)
      .toEqual([
        { provider: "mock", model: "ten-second-stream", thinkingOptionId: "high" },
        { provider: "mock", model: "thirty-minute-stream", thinkingOptionId: "medium" },
      ]);

    await page.getByRole("button", { name: /Ten second stream/ }).click();
    await page.getByText("Max-only thinking stream", { exact: true }).click();
    await expect(effort).toHaveText("Max");
    await effort.click();
    await expect(page.getByRole("menuitem", { name: "Max", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "High", exact: true })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Max", exact: true }).click();

    await page.getByRole("button", { name: /Max-only thinking stream/ }).click();
    await page.getByText("Thirty minute stream", { exact: true }).click();
    await expect(page.getByRole("button", { name: /Thirty minute stream/ })).toBeVisible();
    await expect(effort).toHaveCount(0);
    await expect
      .poll(async () => (await client.getDaemonConfig()).config.metadataGeneration.providers)
      .toEqual([
        { provider: "mock", model: "thirty-minute-stream" },
        { provider: "mock", model: "thirty-minute-stream", thinkingOptionId: "medium" },
      ]);
  } finally {
    try {
      await client.patchDaemonConfig({
        metadataGeneration: {
          providers: previousConfig.config.metadataGeneration.providers,
        },
      });
    } finally {
      await client.close().catch(() => undefined);
    }
  }
});

test("shows effort save failures and allows retrying an existing model without an effort", async ({
  page,
}) => {
  const client = await connectNewWorkspaceDaemonClient({ ownProjects: false });
  const previousConfig = await client.getDaemonConfig();
  let failNextSave = true;
  await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
    const server = browser.connectToServer();
    browser.onMessage((message) => {
      if (typeof message === "string") {
        const envelope = JSON.parse(message);
        const request = envelope.message;
        if (failNextSave && request?.type === "set_daemon_config_request") {
          failNextSave = false;
          browser.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "rpc_error",
                payload: {
                  requestId: request.requestId,
                  requestType: request.type,
                  error: "Injected effort save failure",
                },
              },
            }),
          );
          return;
        }
      }
      server.send(message);
    });
    server.onMessage((message) => browser.send(message));
  });

  try {
    await client.patchDaemonConfig({
      metadataGeneration: { providers: [{ provider: "mock", model: "ten-second-stream" }] },
    });
    await openMetadataGenerationSettings(page);
    const effort = page.getByTestId("metadata-generation-effort");
    await expect(effort).toHaveText("Select thinking option");
    await effort.click();
    await page.getByRole("menuitem", { name: "High", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Injected effort save failure");
    await expect(effort).toHaveText("Select thinking option");
    await effort.click();
    await page.getByRole("menuitem", { name: "High", exact: true }).click();
    await expect(effort).toHaveText("High");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect
      .poll(async () => (await client.getDaemonConfig()).config.metadataGeneration.providers)
      .toEqual([{ provider: "mock", model: "ten-second-stream", thinkingOptionId: "high" }]);
  } finally {
    try {
      await client.patchDaemonConfig({
        metadataGeneration: { providers: previousConfig.config.metadataGeneration.providers },
      });
    } finally {
      await client.close().catch(() => undefined);
    }
  }
});
