// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastApiProvider } from "@/contexts/toast-api-context";
import { i18n } from "@/i18n/i18next";
import { AssistantSelectionCopySurface } from "./surface.web";

const clipboard = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("@/utils/rich-clipboard-default-environment", () => ({
  getDefaultMarkdownClipboardEnvironment: () => ({ writePlainText: clipboard.write }),
}));

const toast = { copied: vi.fn(), show: vi.fn(), error: vi.fn() };

beforeEach(() => {
  vi.stubGlobal("React", React);
  clipboard.write.mockReset().mockResolvedValue(undefined);
  toast.copied.mockClear();
});

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

function mountSurface() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <ToastApiProvider api={toast}>
        <AssistantSelectionCopySurface>
          <div data-testid="assistant-message">
            <span data-paseo-markdown-tag="strong">Selected response</span>
            <input aria-label="Input" />
          </div>
          <div data-testid="unrelated">Sidebar</div>
        </AssistantSelectionCopySurface>
      </ToastApiProvider>
    </QueryClientProvider>,
  );
  return screen.getByText("Selected response");
}

function selectResponse(element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

describe("assistant response context menu", () => {
  it("stays closed without selected text and outside responses", () => {
    const response = mountSurface();
    fireEvent.contextMenu(response);
    expect(screen.queryByTestId("assistant-copy-context-menu")).toBeNull();

    selectResponse(response);
    fireEvent.contextMenu(screen.getByTestId("unrelated"));
    expect(screen.queryByTestId("assistant-copy-context-menu")).toBeNull();
    expect(fireEvent.contextMenu(screen.getByLabelText("Input"))).toBe(true);
    expect(screen.queryByTestId("assistant-copy-context-menu")).toBeNull();
  });

  it("offers only Copy and copies the selection captured before the menu takes focus", async () => {
    const response = mountSurface();
    selectResponse(response);
    fireEvent.contextMenu(response, { clientX: 120, clientY: 80 });

    const menu = screen.getByTestId("assistant-copy-context-menu");
    expect(menu.querySelectorAll('[data-menu-item="true"]')).toHaveLength(1);
    expect(screen.getByTestId("assistant-copy-context-menu-copy").textContent).toBe(
      i18n.t("common.actions.copy"),
    );
    window.getSelection()?.removeAllRanges();
    fireEvent.click(screen.getByTestId("assistant-copy-context-menu-copy"));

    await waitFor(() => expect(clipboard.write).toHaveBeenCalledWith("**Selected response**"));
    await waitFor(() => expect(screen.queryByTestId("assistant-copy-context-menu")).toBeNull());
    expect(toast.copied).toHaveBeenCalledOnce();
  });

  it("keeps a failed copy visible for retry", async () => {
    clipboard.write.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    const response = mountSurface();
    selectResponse(response);
    fireEvent.contextMenu(response, { clientX: 120, clientY: 80 });
    fireEvent.click(screen.getByTestId("assistant-copy-context-menu-copy"));

    await waitFor(() =>
      expect(screen.getByTestId("assistant-copy-context-menu").textContent).toContain(
        i18n.t("common.errors.unableToCopy"),
      ),
    );
    expect(toast.copied).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("assistant-copy-context-menu-copy"));
    await waitFor(() => expect(toast.copied).toHaveBeenCalledOnce());
  });
});
