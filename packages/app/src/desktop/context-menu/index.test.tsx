// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopContentContextMenu } from "@/desktop/host";
import { ToastApiProvider } from "@/contexts/toast-api-context";
import { i18n } from "@/i18n/i18next";
import { DesktopContentContextMenuHost } from "./index.electron";

const bridge = vi.hoisted(() => ({
  listener: undefined as ((payload: unknown) => void) | undefined,
  copyImage: vi.fn(),
  saveImage: vi.fn(),
  write: vi.fn(),
  openLink: vi.fn(),
}));
vi.mock("@/constants/platform", () => ({
  isWeb: true,
  isNative: false,
  getIsElectron: () => true,
}));
vi.mock("@/desktop/host", () => ({
  getDesktopHost: () => ({
    menu: { copyImage: bridge.copyImage, saveImage: bridge.saveImage },
    events: {
      on: async (_event: string, listener: (payload: unknown) => void) => {
        bridge.listener = listener;
        return () => {
          bridge.listener = undefined;
        };
      },
    },
  }),
}));
vi.mock("@/utils/rich-clipboard-default-environment", () => ({
  getDefaultMarkdownClipboardEnvironment: () => ({ writePlainText: bridge.write }),
}));
vi.mock("@/utils/copy-to-clipboard", () => ({
  copyToClipboard: (text: string) => bridge.write(text),
}));
vi.mock("@/utils/open-external-url", () => ({
  openExternalUrl: (url: string) => bridge.openLink(url),
}));

const toast = { copied: vi.fn(), show: vi.fn(), error: vi.fn() };
const params: DesktopContentContextMenu = {
  x: 20,
  y: 30,
  selectionText: "",
  linkURL: "",
  srcURL: "",
  hasImageContents: false,
};

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.clearAllMocks();
  bridge.write.mockReset().mockResolvedValue(undefined);
  bridge.copyImage.mockResolvedValue(undefined);
  bridge.saveImage.mockResolvedValue(undefined);
  bridge.openLink.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

async function mountMenu() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <ToastApiProvider api={toast}>
        <DesktopContentContextMenuHost />
        <div data-testid="assistant-message">
          <span data-paseo-markdown-tag="strong">Selected response</span>
        </div>
      </ToastApiProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(bridge.listener).toBeTypeOf("function"));
}

function openMenu(overrides: Partial<DesktopContentContextMenu> = {}) {
  act(() => bridge.listener!({ ...params, ...overrides }));
}

function menuLabels() {
  return Array.from(
    screen.getByTestId("desktop-content-context-menu").querySelectorAll('[data-menu-item="true"]'),
  ).map((item) => item.textContent);
}

describe("desktop content menu", () => {
  it("stays closed without copyable content", async () => {
    await mountMenu();
    openMenu();
    expect(screen.queryByTestId("desktop-content-context-menu")).toBeNull();
  });

  it("copies a selected response with its formatting after the selection clears", async () => {
    await mountMenu();
    const range = document.createRange();
    range.selectNodeContents(screen.getByText("Selected response"));
    window.getSelection()!.addRange(range);
    openMenu({ selectionText: "Selected response" });
    expect(menuLabels()).toEqual([i18n.t("common.actions.copy")]);
    window.getSelection()?.removeAllRanges();
    fireEvent.click(screen.getByTestId("desktop-content-context-menu-copy"));
    await waitFor(() => expect(bridge.write).toHaveBeenCalledWith("**Selected response**"));
    await waitFor(() => expect(screen.queryByTestId("desktop-content-context-menu")).toBeNull());
    expect(toast.copied).toHaveBeenCalledOnce();
  });

  it("offers link actions and Copy for a selected link", async () => {
    await mountMenu();
    openMenu({ linkURL: "https://example.com", selectionText: "Example" });
    expect(menuLabels()).toEqual([
      i18n.t("desktop.contextMenu.openLink"),
      i18n.t("desktop.contextMenu.copyLinkAddress"),
      i18n.t("common.actions.copy"),
    ]);
    fireEvent.click(screen.getByTestId("desktop-content-context-menu-copy-link"));
    await waitFor(() => expect(bridge.write).toHaveBeenCalledWith("https://example.com"));
  });

  it("offers only image actions and invokes the native image operations", async () => {
    await mountMenu();
    const image = {
      hasImageContents: true,
      srcURL: "https://example.com/image.png",
      linkURL: "https://example.com",
      selectionText: "Example",
    };
    openMenu(image);
    expect(menuLabels()).toEqual([
      i18n.t("desktop.contextMenu.copyImage"),
      i18n.t("desktop.contextMenu.saveImage"),
    ]);
    fireEvent.click(screen.getByTestId("desktop-content-context-menu-copy-image"));
    await waitFor(() => expect(bridge.copyImage).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByTestId("desktop-content-context-menu")).toBeNull());
    openMenu(image);
    fireEvent.click(screen.getByTestId("desktop-content-context-menu-save-image"));
    await waitFor(() => expect(bridge.saveImage).toHaveBeenCalledOnce());
  });

  it("keeps a failed action visible for retry", async () => {
    await mountMenu();
    bridge.write.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    openMenu({ selectionText: "Example" });
    fireEvent.click(screen.getByTestId("desktop-content-context-menu-copy"));
    await waitFor(() =>
      expect(screen.getByTestId("desktop-content-context-menu").textContent).toContain(
        i18n.t("desktop.contextMenu.actionFailed"),
      ),
    );
    fireEvent.click(screen.getByTestId("desktop-content-context-menu-copy"));
    await waitFor(() => expect(toast.copied).toHaveBeenCalledOnce());
  });
});
