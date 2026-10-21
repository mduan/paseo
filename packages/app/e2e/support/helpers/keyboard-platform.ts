import type { Page } from "@playwright/test";

// eslint-disable-next-line typescript/consistent-type-definitions -- Workspace instructions require type aliases.
type KeyboardPlatformOptions = { page: Page; userAgent: string; platform: string };

async function setKeyboardPlatform({
  page,
  userAgent,
  platform,
}: KeyboardPlatformOptions): Promise<void> {
  const browserSession = await page.context().newCDPSession(page);
  // A user-agent override alone leaves navigator.platform tied to the host OS.
  await browserSession.send("Emulation.setUserAgentOverride", { userAgent, platform });
}

export function emulateWindowsKeyboard(page: Page): Promise<void> {
  return setKeyboardPlatform({
    page,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    platform: "Win32",
  });
}

export function emulateLinuxKeyboard(page: Page): Promise<void> {
  return setKeyboardPlatform({
    page,
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    platform: "Linux x86_64",
  });
}
