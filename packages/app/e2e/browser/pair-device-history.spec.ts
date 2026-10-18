import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "../support/fixtures";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { preparePairingHost } from "../support/helpers/pair-device";

test("groups connection history by device and time, including compact layout and host disconnect", async ({
  page,
}, testInfo) => {
  const paseoHome = await mkdtemp(path.join(tmpdir(), "paseo-history-ui-"));
  const today = new Date();
  today.setHours(9, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const endedAt = new Date(yesterday.getTime() + 60_000).toISOString();
  const history = {
    devices: [
      {
        clientId: "cid_0f67abcd",
        label: "iPhone",
        kind: "mobile",
        transport: "relay",
        appVersion: "0.10.3",
        sessions: [
          {
            id: "phone-yesterday",
            connectedAt: yesterday.toISOString(),
            disconnectedAt: endedAt,
            transport: "relay",
            appVersion: "0.10.3",
          },
        ],
      },
    ],
    pairingCodeResets: [today.toISOString()],
  };
  await writeFile(path.join(paseoHome, "connection-history.json"), JSON.stringify(history));
  const historyFile = path.join(paseoHome, "connection-history.json");
  const daemon = await startIsolatedHostDaemon("connection-history-ui", { paseoHome });
  try {
    await preparePairingHost(page, daemon);
    const section = page.getByTestId("connection-history");
    const phone = page.getByTestId("history-device-cid_0f67abcd-toggle");
    const device = page.getByTestId("history-device-cid_0f67abcd");
    const menu = page.getByTestId("history-device-cid_0f67abcd-menu");
    await expect(device).toContainText("Old app version");
    await expect(device).toContainText("Relay · v0.10.3");
    await expect(phone).toHaveText("1 connection");
    await expect(phone).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await page.getByRole("menuitem", { name: "Rename device", exact: true }).click();
    await expect(phone).toHaveAttribute("aria-expanded", "false");
    const input = page.getByTestId("history-rename-modal-input");
    const save = page.getByTestId("history-rename-modal-submit");
    await expect(input).toHaveValue("iPhone");
    await input.fill("   ");
    await expect(save).toBeDisabled();
    await input.fill("  Personal phone  ");
    await save.click();
    await expect(page.getByTestId("history-rename-modal")).toHaveCount(0);
    await expect(device.getByText("Personal phone", { exact: true })).toBeVisible();
    expect(JSON.parse(await readFile(historyFile, "utf8")).devices[0].customLabel).toBe(
      "Personal phone",
    );
    await phone.click();
    await expect(phone).toHaveAttribute("aria-expanded", "true");
    await expect(section.getByText("1m", { exact: true })).toBeVisible();
    await page.getByTestId("history-group-time").click();
    await expect(section.getByText("Today", { exact: true })).toBeVisible();
    await expect(section.getByText("Yesterday", { exact: true })).toBeVisible();
    await expect(section.getByText("Pairing code reset", { exact: true })).toBeVisible();
    await section.getByRole("button", { name: "Personal phone", exact: true }).click();
    await expect(phone).toHaveAttribute("aria-expanded", "true");
    await expect(section.getByText("1m", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("history-device.png") });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(phone).toBeVisible();
    await page.getByTestId("history-group-time").click();
    await expect(section.getByText("Pairing code reset", { exact: true })).toBeVisible();
    await expect(
      section.getByRole("button", { name: "Personal phone", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("history-time-compact.png") });
    await section.getByRole("button", { name: "Personal phone", exact: true }).click();
    await expect(phone).toHaveAttribute("aria-expanded", "true");
    await expect(section.getByText("1m", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("history-device-compact.png") });
    // A real filesystem failure must keep the draft open and permit a successful retry.
    await menu.click();
    await page.getByText("Rename device", { exact: true }).click();
    await expect(input).toHaveValue("Personal phone");
    await input.fill("Travel phone");
    const savedHistory = await readFile(historyFile, "utf8");
    await rm(historyFile);
    await mkdir(historyFile);
    await save.click();
    await expect(page.getByTestId("history-rename-modal-error")).toHaveText("Unable to save");
    await expect(input).toHaveValue("Travel phone");
    await expect(save).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("history-rename-error-compact.png") });
    await rm(historyFile, { recursive: true });
    await writeFile(historyFile, savedHistory);
    await save.click();
    await expect(page.getByTestId("history-rename-modal")).toHaveCount(0);
    await expect(device.getByText("Travel phone", { exact: true })).toBeVisible();
    await menu.click();
    await page.getByText("Rename device", { exact: true }).click();
    await input.fill("Cancelled name");
    await page.getByTestId("history-rename-modal-cancel").click();
    await expect(device.getByText("Travel phone", { exact: true })).toBeVisible();
    await page.getByTestId("history-group-time").click();
    await expect(section.getByRole("button", { name: "Travel phone", exact: true })).toBeVisible();
    await section.getByRole("button", { name: "Travel phone", exact: true }).click();
    await expect(phone).toHaveAttribute("aria-expanded", "true");
    await page.screenshot({ path: testInfo.outputPath("history-renamed-compact.png") });

    await daemon.close();
    await expect(section.getByText("Host is not connected", { exact: false })).toBeVisible();
    await expect(section.getByText("Connected", { exact: true })).toHaveCount(0);
  } finally {
    await daemon.close();
  }
});
