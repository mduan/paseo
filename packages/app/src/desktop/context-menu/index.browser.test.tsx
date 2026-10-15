import React, { useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { View, Text, Pressable } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReducedMotionConfig, ReduceMotion } from "react-native-reanimated";
import { I18nextProvider } from "react-i18next";
import { i18n } from "@/i18n/i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { ModalPortal } from "@/components/ui/modal-portal";
import { AttachmentLightbox, type ImageLightboxSource } from "@/components/attachment-lightbox";
import { ToastApiProvider } from "@/contexts/toast-api-context";
import { DesktopContentContextMenuHost } from "./index.electron";
import type { DesktopContentContextMenu } from "@/desktop/host";
import { useGlobalWebOverlayLayer, useWebOverlayRegistration } from "@/lib/overlay-root";

const bridge = vi.hoisted(() => ({
  listener: undefined as ((payload: DesktopContentContextMenu) => void) | undefined,
  copyImage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("@/constants/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/platform")>()),
  isWeb: true,
  isNative: false,
  getIsElectron: () => true,
}));
vi.mock("@/desktop/electron/events", () => ({
  listenToDesktopEvent: async (_event: string, listener: typeof bridge.listener) => {
    bridge.listener = listener;
    return () => {
      bridge.listener = undefined;
    };
  },
}));
vi.mock("@/desktop/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/desktop/host")>()),
  getDesktopHost: () => ({ menu: { copyImage: bridge.copyImage } }),
}));
vi.mock("@/attachments/use-attachment-preview-url", () => ({
  useAttachmentPreviewUrl: () => null,
}));
vi.mock("@/utils/desktop-window", () => ({
  WindowChromeRootRegion: ({ children }: { children: React.ReactNode }) => children,
}));

const uri =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="red"/></svg>',
  );
const toast = { copied: vi.fn(), show: vi.fn(), error: vi.fn() };
const source: ImageLightboxSource = { type: "uri", uri, contentSize: { width: 200, height: 200 } };
let root: Root;

function Harness() {
  const [open, setOpen] = useState(true);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <DesktopContentContextMenuHost />
      <AttachmentLightbox source={open ? source : null} onClose={close} />
    </>
  );
}

function SelectionModal() {
  const [open, setOpen] = useState(true);
  const close = useCallback(() => setOpen(false), []);
  const layer = useGlobalWebOverlayLayer("modal", open);
  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== "Escape") return false;
      close();
      return true;
    },
    [close],
  );
  const setScope = useWebOverlayRegistration({ active: open, layer, onKeyDown: handleKey });
  return (
    <>
      <DesktopContentContextMenuHost />
      <ModalPortal layer={layer} visible={open} transparent onRequestClose={close}>
        <View ref={setScope} testID="selection-modal" tabIndex={-1}>
          <Text testID="selection-modal-text">Select this dialog text</Text>
          <Pressable onPress={close} accessibilityRole="button" testID="selection-modal-close">
            <Text>Close</Text>
          </Pressable>
        </View>
      </ModalPortal>
    </>
  );
}

afterEach(() => {
  root?.unmount();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function mountHarness(element: React.ReactNode) {
  vi.stubGlobal("React", React);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ReducedMotionConfig mode={ReduceMotion.Always} />
        <I18nextProvider i18n={i18n}>
          <ToastApiProvider api={toast}>{element}</ToastApiProvider>
        </I18nextProvider>
      </QueryClientProvider>,
    ),
  );
}

async function openImageMenu() {
  mountHarness(<Harness />);
  await expect.poll(() => bridge.listener).toBeTypeOf("function");
  const image = document.querySelector<HTMLElement>('[data-testid="attachment-lightbox-image"]')!;
  await expect.poll(() => image.getBoundingClientRect().width).toBeGreaterThan(0);
  const rect = image.getBoundingClientRect();
  await userEvent.click(image, { button: "right" });
  // Electron delivers image metadata over IPC after the renderer's right click.
  flushSync(() =>
    bridge.listener!({
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      selectionText: "",
      linkURL: "",
      srcURL: uri,
      hasImageContents: true,
    }),
  );
  await expect
    .poll(() => {
      const copy = document.querySelector<HTMLElement>(
        '[data-testid="desktop-content-context-menu-copy-image"]',
      )!;
      const bounds = copy.getBoundingClientRect();
      return copy.contains(
        document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
      );
    })
    .toBe(true);
}

describe("image lightbox desktop context menu", () => {
  it("paints image actions above the viewer and allows copying and dismissal", async () => {
    await openImageMenu();
    await page.getByTestId("desktop-content-context-menu-copy-image").click();
    await expect.poll(() => bridge.copyImage.mock.calls.length).toBe(1);
    await expect
      .poll(() => document.querySelector('[data-testid="desktop-content-context-menu"]'))
      .toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect
      .poll(() => document.querySelector('[data-testid="attachment-lightbox"]'))
      .toBeNull();
  });

  it("dismisses the menu before the viewer on Escape", async () => {
    await openImageMenu();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByTestId("desktop-content-context-menu")).not.toBeInTheDocument();
    await expect.element(page.getByTestId("attachment-lightbox")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByTestId("attachment-lightbox")).not.toBeInTheDocument();
  });

  it("allows background dismissal after a right click", async () => {
    await openImageMenu();
    await page
      .getByTestId("desktop-content-context-menu-backdrop")
      .click({ position: { x: 5, y: 5 } });
    await expect.element(page.getByTestId("desktop-content-context-menu")).not.toBeInTheDocument();
    await expect.element(page.getByTestId("attachment-lightbox")).toBeVisible();
    await page.getByTestId("attachment-lightbox-canvas").click({ position: { x: 5, y: 5 } });
    await expect.element(page.getByTestId("attachment-lightbox")).not.toBeInTheDocument();
  });
});

it("keeps a selected-text menu above a modal without competing focus traps", async () => {
  let focusEvents = 0;
  const boundFocusLoop = (event: FocusEvent) => {
    // Bound the old focus loop so a regression fails instead of hanging Chromium.
    if (++focusEvents > 20) event.stopImmediatePropagation();
  };
  document.addEventListener("focus", boundFocusLoop, true);
  try {
    mountHarness(<SelectionModal />);
    await expect.element(page.getByTestId("selection-modal")).toBeVisible();
    const text = page.getByTestId("selection-modal-text");
    await text.click({ button: "right" });
    const rect = text.element().getBoundingClientRect();
    focusEvents = 0;
    flushSync(() =>
      bridge.listener!({
        x: rect.x,
        y: rect.y,
        selectionText: "Select this dialog text",
        linkURL: "",
        srcURL: "",
        hasImageContents: false,
      }),
    );
    const copy = page.getByTestId("desktop-content-context-menu-copy");
    await expect.element(copy).toBeVisible();
    await expect.poll(() => document.activeElement === copy.element()).toBe(true);
    expect(focusEvents).toBeLessThan(20);
    const bounds = copy.element().getBoundingClientRect();
    expect(
      copy
        .element()
        .contains(
          document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
        ),
    ).toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect.element(copy).not.toBeInTheDocument();
    await expect.element(page.getByTestId("selection-modal")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByTestId("selection-modal")).not.toBeInTheDocument();
  } finally {
    document.removeEventListener("focus", boundFocusLoop, true);
  }
});
