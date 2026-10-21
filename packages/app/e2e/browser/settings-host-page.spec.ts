import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";
import { TEST_HOST_LABEL } from "../support/helpers/daemon-registry";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { getServerId } from "../support/helpers/server-id";
import {
  expectSettingsHeader,
  openSettingsHost,
  openHostSection,
  expectHostLabelDisplayed,
  clickEditHostLabel,
  expectHostLabelEditMode,
  expectHostConnectionsCard,
  expectHostInjectMcpCard,
  expectHostActionCards,
  expectHostProvidersCard,
  expectHostNoDaemonLifecycleRow,
  expectRetiredSidebarSectionsAbsent,
  expectHostPageVisible,
  seedSavedSettingsHosts,
  selectSettingsHost,
  expectHostRejectedWithReAddGuidance,
  expectNoHostPasswordControls,
  removeHostFromHostPage,
  addDirectHostFromSettings,
  expectHostOnlineWithoutError,
} from "../support/helpers/settings";

test.describe("Settings host page", () => {
  test("visits host settings and opens the label editor", async ({ page }) => {
    const serverId = getServerId();
    const port = getE2EDaemonPort();
    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, serverId);
    await test.step("connections section shows the seeded connection endpoint", async () => {
      await expectSettingsHeader(page, "Connections");
      await expectHostConnectionsCard(page, port);
    });
    await test.step("agents section shows the inject MCP toggle", async () => {
      await openHostSection(page, serverId, "agents");
      await expectSettingsHeader(page, "Agents");
      await expectHostInjectMcpCard(page);
    });
    await test.step("providers section shows the providers card", async () => {
      await expectHostProvidersCard(page, serverId);
      await expectSettingsHeader(page, "Providers");
    });
    await test.step("host section shows the host label and restart/remove action cards", async () => {
      await openHostSection(page, serverId, "host");
      await expectSettingsHeader(page, "Overview");
      await expectHostLabelDisplayed(page);
      await expectHostActionCards(page, serverId);
    });
    await test.step("clicking the label pencil reveals the inline editor", async () => {
      await openHostSection(page, serverId, "host");

      await expectHostLabelDisplayed(page);
      await clickEditHostLabel(page);
      await expectHostLabelEditMode(page, TEST_HOST_LABEL);
      await page.keyboard.press("Escape");
    });
    await test.step("host section does not render daemon lifecycle controls for a remote daemon", async () => {
      await openHostSection(page, serverId, "host");

      await expectHostNoDaemonLifecycleRow(page);
    });
    await test.step("settings sidebar exposes the flat App and Host section rows", async () => {
      await expectRetiredSidebarSectionsAbsent(page);
    });
  });

  test("a failed remote daemon update remains visible in the host UI", async ({
    page,
    outdatedDaemon,
  }) => {
    await seedSavedSettingsHosts(page, [outdatedDaemon]);
    await page.reload();
    await openSettings(page);
    await openSettingsHost(page, outdatedDaemon.serverId);
    await openHostSection(page, outdatedDaemon.serverId, "host");

    page.once("dialog", (dialog) => dialog.accept());
    const updateButton = page.getByTestId("host-page-update-button");
    await updateButton.click();

    await expect(
      updateButton.filter({ hasText: /Preparing update|Downloading packages|Installing/ }),
    ).toBeDisabled();

    const updateFailure = page.getByTestId("host-page-update-error");
    await expect(updateFailure).toBeVisible();
    await expect(updateFailure).toContainText("Update failed");
    await expect(updateFailure).toContainText("Failed to update the daemon:");
    await expect(updateButton).toBeEnabled();
  });

  test("a host rejected for its password reconnects after being removed and added again with it", async ({
    page,
  }) => {
    const password = "e2e host password";
    const daemon = await startIsolatedHostDaemon("srv_e2e_password_host", {
      environment: { ...process.env, PASEO_PASSWORD: password },
    });
    try {
      await seedSavedSettingsHosts(page, [
        {
          serverId: getServerId(),
          label: TEST_HOST_LABEL,
          endpoint: `127.0.0.1:${getE2EDaemonPort()}`,
        },
        {
          serverId: daemon.serverId,
          label: "Password host",
          endpoint: `127.0.0.1:${daemon.port}`,
        },
      ]);
      await page.reload();
      await openSettings(page);
      await selectSettingsHost(page, daemon.serverId);
      await openHostSection(page, daemon.serverId, "host");

      await test.step("the host page shows the reason and the re-add guidance, with no password UI", async () => {
        await expectHostRejectedWithReAddGuidance(page, "Password required");
        await expectNoHostPasswordControls(page);
      });

      await test.step("removing the host and adding it again with the password brings it online", async () => {
        await removeHostFromHostPage(page, daemon.serverId);
        await addDirectHostFromSettings(page, { host: "127.0.0.1", port: daemon.port, password });
        await openHostSection(page, daemon.serverId, "host");
        await expectHostOnlineWithoutError(page);
      });
    } finally {
      await daemon.close();
    }
  });

  test("navigating to /settings/hosts/[serverId] redirects to the connections section", async ({
    page,
  }) => {
    const serverId = getServerId();

    await gotoAppShell(page);
    await page.goto(`/settings/hosts/${encodeURIComponent(serverId)}`);

    await expectHostPageVisible(page, serverId);
    await expectSettingsHeader(page, "Connections");
    await openHostSection(page, serverId, "host");
    await expectHostLabelDisplayed(page);
    await expectHostActionCards(page, serverId);
  });
});

test("Linear integration keeps saved keys private and exposes disconnect failures", async ({
  page,
}, testInfo) => {
  const serverId = getServerId();
  const home = process.env.E2E_PASEO_HOME;
  if (!home) throw new Error("Missing isolated daemon home");
  const file = path.join(home, "integrations", "linear.json");
  const saved = JSON.stringify({
    apiKey: "saved-test-key",
    organizationName: "Mixpanel",
  });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, saved, { mode: 0o600 });
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHost(page, serverId);
  await openHostSection(page, serverId, "integrations");
  await expect(page.getByTestId("linear-connection-status")).toHaveText("Connected · Mixpanel");
  await page.getByRole("button", { name: "Replace key", exact: true }).click();
  const input = page.getByTestId("linear-api-key");
  await expect(input).toHaveValue("");
  await expect(input).toHaveAttribute("type", "password");
  await expect(page.getByText(/Stored on/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Create API key" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("linear-inline-card.png"), fullPage: true });
  await input.fill("draft-test-key");
  await page.getByRole("button", { name: "Show API key" }).click();
  await expect(input).toHaveJSProperty("type", "text");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Replace key", exact: true }).click();
  await expect(page.getByTestId("linear-api-key")).toHaveValue("");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await rm(file);
  await mkdir(file);
  await writeFile(path.join(file, "prevent-removal"), "test");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByTestId("linear-disconnect-error")).toBeVisible();
  await expect(page.getByTestId("linear-connection-status")).toHaveText("Connected · Mixpanel");
  await rm(file, { recursive: true });
  await writeFile(file, saved, { mode: 0o600 });
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByTestId("linear-connection-status")).toHaveText("Not connected");
  await expect(page.getByTestId("linear-api-key")).toHaveValue("");
  await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
});

test("Linear integration isolates hosts and retries a failed connection read", async ({ page }) => {
  const secondary = await startIsolatedHostDaemon("srv_linear_settings_second");
  try {
    const file = path.join(secondary.paseoHome, "integrations", "linear.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "invalid JSON");
    await seedSavedSettingsHosts(page, [
      { serverId: getServerId(), label: "First host", endpoint: `127.0.0.1:${getE2EDaemonPort()}` },
      {
        serverId: secondary.serverId,
        label: "Second host",
        endpoint: `127.0.0.1:${secondary.port}`,
      },
    ]);
    await page.reload();
    await openSettings(page);
    await openSettingsHost(page, getServerId());
    await openHostSection(page, getServerId(), "integrations");
    await expect(page.getByTestId("linear-connection-status")).toHaveText("Not connected");
    await selectSettingsHost(page, secondary.serverId);
    await expect(page.getByRole("alert")).toContainText(
      "Unable to read the saved Linear connection",
    );
    await writeFile(
      file,
      JSON.stringify({
        apiKey: "second-host-key",
        organizationName: "Other workspace",
      }),
      { mode: 0o600 },
    );
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByTestId("linear-connection-status")).toHaveText(
      "Connected · Other workspace",
    );
    await selectSettingsHost(page, getServerId());
    await expect(page.getByTestId("linear-connection-status")).toHaveText("Not connected");
  } finally {
    await secondary.close();
  }
});

test("Linear integration shows the inline form on a compact screen", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoAppShell(page);
  await page.goto(`/settings/hosts/${getServerId()}/integrations`);
  await expect(page.getByTestId("linear-key-form")).toBeVisible();
  await expect(page.getByTestId("linear-api-key")).toBeVisible();
  await expect(page.getByRole("link", { name: "Create API key" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save key", exact: true })).toBeVisible();
  await expect(page.getByText(/Stored on/)).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("linear-inline-card-compact.png"),
    fullPage: true,
  });
});
