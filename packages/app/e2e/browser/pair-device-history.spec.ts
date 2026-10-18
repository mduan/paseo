import { mkdtemp, writeFile } from "node:fs/promises";
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
  const daemon = await startIsolatedHostDaemon("connection-history-ui", { paseoHome });
  try {
    await preparePairingHost(page, daemon);
    const section = page.getByTestId("connection-history");
    const phone = page.getByTestId("history-device-cid_0f67abcd-toggle");
    await expect(phone).toContainText("Old app version");
    await expect(phone).toContainText("Relay · v0.10.3 · 1 connection");
    await phone.click();
    await expect(phone).toHaveAttribute("aria-expanded", "true");
    await expect(section.getByText("1m", { exact: true })).toBeVisible();
    await page.getByTestId("history-group-time").click();
    await expect(section.getByText("Today", { exact: true })).toBeVisible();
    await expect(section.getByText("Yesterday", { exact: true })).toBeVisible();
    await expect(section.getByText("Pairing code reset", { exact: true })).toBeVisible();
    await section.getByRole("button", { name: "iPhone", exact: true }).click();
    await expect(phone).toHaveAttribute("aria-expanded", "true");
    await expect(section.getByText("1m", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("history-device.png") });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(phone).toBeVisible();
    await page.getByTestId("history-group-time").click();
    await expect(section.getByText("Pairing code reset", { exact: true })).toBeVisible();
    await expect(section.getByRole("button", { name: "iPhone", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("history-time-compact.png") });
    await section.getByRole("button", { name: "iPhone", exact: true }).click();
    await expect(phone).toHaveAttribute("aria-expanded", "true");
    await expect(section.getByText("1m", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("history-device-compact.png") });

    await daemon.close();
    await expect(section.getByText("Host is not connected", { exact: false })).toBeVisible();
    await expect(section.getByText("Connected", { exact: true })).toHaveCount(0);
  } finally {
    await daemon.close();
  }
});
