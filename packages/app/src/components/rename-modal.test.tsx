import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConversationTitleTarget } from "@getpaseo/protocol/messages";
import { useAiRename, useAiRenamePending } from "@/workspace/ai-rename/use-ai-rename";

import { JSDOM } from "jsdom";
import React, { act, useCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdaptiveRenameModal } from "./rename-modal";

const aiRenameTest = vi.hoisted(() => ({
  supported: true,
  title: "Original title",
  generate: vi.fn<() => Promise<string>>(),
  setWorkspaceTitle: vi.fn<() => Promise<void>>(),
  updateAgent: vi.fn<() => Promise<void>>(),
  error: vi.fn(),
}));
vi.mock("@/runtime/host-features", () => ({ useHostFeature: () => aiRenameTest.supported }));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getClient: () => ({
      generateConversationTitle: aiRenameTest.generate,
      setWorkspaceTitle: aiRenameTest.setWorkspaceTitle,
      updateAgent: aiRenameTest.updateAgent,
    }),
  }),
}));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ error: aiRenameTest.error }) }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: {
    getState: () => ({
      sessions: {
        host: {
          workspaces: new Map([["target", { title: aiRenameTest.title }]]),
          agents: new Map([["target", { title: aiRenameTest.title }]]),
          agentDetails: new Map(),
        },
      },
    }),
  },
}));

const { theme, adaptiveInputState } = vi.hoisted(() => ({
  adaptiveInputState: {
    latestProps: null as {
      onChangeText?: (next: string) => void;
      onSubmitEditing?: () => void;
    } | null,
  },
  theme: {
    spacing: { 2: 8, 3: 12 },
    fontSize: { sm: 13, base: 15 },
    borderRadius: { md: 6 },
    colors: {
      surface0: "#000",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      border: "#555",
      palette: { red: { 300: "#f87171" } },
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
}));

vi.mock("@/constants/platform", () => ({
  isWeb: true,
  isNative: false,
}));

vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await import("react");
  const AdaptiveModalSheet = ({
    visible,
    title,
    children,
    onClose,
    testID,
  }: {
    visible: boolean;
    title: string;
    children: React.ReactNode;
    onClose: () => void;
    testID?: string;
  }) => {
    if (!visible) return null;
    return ReactModule.createElement(
      "div",
      { "data-testid": testID ?? "adaptive-modal-sheet", "data-modal-title": title },
      ReactModule.createElement(
        "button",
        {
          type: "button",
          "data-testid": "adaptive-modal-sheet-close",
          onClick: onClose,
        },
        "Close",
      ),
      children,
    );
  };
  // Mirrors production AdaptiveTextInput: native-owned input seeded by
  // initialValue, remounted (via key) when resetKey changes so the new
  // initialValue takes effect.
  const AdaptiveTextInput = ReactModule.forwardRef<HTMLInputElement, Record<string, unknown>>(
    (props, ref) => {
      const p = props as {
        initialValue?: string;
        defaultValue?: string;
        editable?: boolean;
        maxLength?: number;
        testID?: string;
        onChangeText?: (next: string) => void;
        onSubmitEditing?: () => void;
      };
      adaptiveInputState.latestProps = {
        onChangeText: p.onChangeText,
        onSubmitEditing: p.onSubmitEditing,
      };
      return ReactModule.createElement("input", {
        ref,
        defaultValue: p.initialValue ?? p.defaultValue ?? "",
        disabled: p.editable === false,
        maxLength: p.maxLength,
        "data-testid": p.testID,
        onChange: (e: { target: { value: string } }) => p.onChangeText?.(e.target.value),
        onKeyDown: (e: { key: string; preventDefault: () => void }) => {
          if (e.key === "Enter") {
            e.preventDefault();
            p.onSubmitEditing?.();
          }
        },
      });
    },
  );
  return { AdaptiveModalSheet, AdaptiveTextInput };
});

vi.mock("@/components/ui/button", async () => {
  const ReactModule = await import("react");
  return {
    Button: ({
      children,
      onPress,
      disabled,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      testID?: string;
    }) =>
      ReactModule.createElement(
        "button",
        {
          type: "button",
          "data-testid": testID,
          disabled: disabled || undefined,
          onClick: () => !disabled && onPress?.(),
        },
        children,
      ),
  };
});

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("HTMLInputElement", dom.window.HTMLInputElement);
  vi.stubGlobal("KeyboardEvent", dom.window.KeyboardEvent);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("navigator", dom.window.navigator);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  adaptiveInputState.latestProps = null;
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

interface RenderOptions {
  visible?: boolean;
  initialValue?: string;
  title?: string;
  placeholder?: string;
  submitLabel?: string;
  onClose?: () => void;
  onSubmit?: (value: string) => Promise<void> | void;
  validate?: (value: string) => string | null;
  maxLength?: number;
}

function renderModal(options: RenderOptions = {}): void {
  const {
    visible = true,
    initialValue = "",
    title = "Rename",
    placeholder,
    submitLabel,
    onClose = vi.fn(),
    onSubmit = vi.fn(),
    validate,
    maxLength,
  } = options;
  act(() => {
    root?.render(
      <AdaptiveRenameModal
        visible={visible}
        title={title}
        initialValue={initialValue}
        placeholder={placeholder}
        submitLabel={submitLabel}
        onClose={onClose}
        onSubmit={onSubmit}
        validate={validate}
        maxLength={maxLength}
        testID="rename-modal"
      />,
    );
  });
}

function queryInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('[data-testid="rename-modal-input"]');
}

function querySubmit(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-testid="rename-modal-submit"]');
}

function queryCancel(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-testid="rename-modal-cancel"]');
}

function queryError(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="rename-modal-error"]');
}

function click(element: Element | null): void {
  if (!element) throw new Error("Cannot click null element");
  act(() => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

function typeInto(value: string): void {
  act(() => {
    adaptiveInputState.latestProps?.onChangeText?.(value);
  });
}

function pressEnter(): void {
  act(() => {
    adaptiveInputState.latestProps?.onSubmitEditing?.();
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("RenameModal", () => {
  it("renders with the initial value pre-filled and selects it after open", async () => {
    vi.useFakeTimers();
    renderModal({ initialValue: "main" });
    const input = queryInput();
    expect(input).not.toBeNull();
    expect(input?.value).toBe("main");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const focused = document.activeElement as HTMLInputElement | null;
    expect(focused).toBe(input);
    expect(focused?.selectionStart).toBe(0);
    expect(focused?.selectionEnd).toBe("main".length);
  });

  it("submits on Enter keypress in the input when the value has changed", async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    renderModal({ initialValue: "feature", onSubmit, onClose });

    typeInto("feature-2");
    pressEnter();
    await flush();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("feature-2");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when AdaptiveModalSheet's close prop fires (cancel button / backdrop delegated)", () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    renderModal({ initialValue: "main", onClose, onSubmit });

    click(document.querySelector('[data-testid="adaptive-modal-sheet-close"]'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables submit when draft equals initialValue and re-enables after a change", async () => {
    const onSubmit = vi.fn();
    renderModal({ initialValue: "main", onSubmit });

    expect(querySubmit()?.disabled).toBe(true);

    pressEnter();
    await flush();
    expect(onSubmit).not.toHaveBeenCalled();

    typeInto("main-v2");
    await flush();
    expect(querySubmit()?.disabled).toBe(false);

    typeInto("main");
    await flush();
    expect(querySubmit()?.disabled).toBe(true);
  });

  it("surfaces validate errors inline and blocks submission", async () => {
    const onSubmit = vi.fn();
    const validate = vi.fn((value: string) => (value === "bad" ? "Invalid name" : null));
    renderModal({ initialValue: "ok", validate, onSubmit });

    typeInto("bad");
    const submit = querySubmit()!;
    expect(submit.disabled).toBe(true);

    pressEnter();
    await flush();

    expect(onSubmit).not.toHaveBeenCalled();
    const errorNode = queryError();
    expect(errorNode?.textContent).toContain("Invalid name");
  });

  it("disables the submit button while onSubmit is pending", async () => {
    let resolve: () => void = () => {};
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    renderModal({ initialValue: "main", onSubmit });

    typeInto("main-renamed");
    click(querySubmit());
    await flush();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(querySubmit()?.disabled).toBe(true);
    expect(queryCancel()?.disabled).toBe(true);

    await act(async () => {
      resolve();
      await Promise.resolve();
    });
  });

  it("keeps the modal open with an error when onSubmit rejects", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Server said no"));
    const onClose = vi.fn();
    renderModal({ initialValue: "main", onSubmit, onClose });

    typeInto("main-renamed");
    click(querySubmit());
    await flush();

    expect(onClose).not.toHaveBeenCalled();
    expect(queryError()?.textContent).toContain("Server said no");
    expect(querySubmit()?.disabled).toBe(false);
  });
});

function AiRenameHarness({ target }: { target: ConversationTitleTarget }) {
  const ai = useAiRename("host", target);
  const pending = useAiRenamePending({ serverId: "host", target, id: "target" });
  const rename = ai.rename;
  const handleRename = useCallback(() => {
    rename("target");
    rename("target");
  }, [rename]);
  return (
    <button type="button" data-testid="ai-rename" disabled={!ai.supported} onClick={handleRename}>
      {pending ? "Pending" : "Ready"}
    </button>
  );
}

describe("AI rename", () => {
  beforeEach(() => {
    aiRenameTest.title = "Original title";
    aiRenameTest.supported = true;
    aiRenameTest.generate.mockReset();
    aiRenameTest.setWorkspaceTitle.mockReset().mockResolvedValue();
    aiRenameTest.updateAgent.mockReset().mockResolvedValue();
    aiRenameTest.error.mockReset();
  });

  function renderAiRename(target: ConversationTitleTarget) {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    act(() =>
      root?.render(
        <QueryClientProvider client={client}>
          <AiRenameHarness target={target} />
        </QueryClientProvider>,
      ),
    );
    return client;
  }

  it.each([ConversationTitleTarget.Agent, ConversationTitleTarget.Workspace])(
    "applies one %s name, tracks pending, and prevents duplicate generation",
    async (target) => {
      let resolve: ((title: string) => void) | undefined;
      aiRenameTest.generate.mockImplementation(
        () =>
          new Promise<string>((done) => {
            resolve = done;
          }),
      );
      const client = renderAiRename(target);
      click(document.querySelector('[data-testid="ai-rename"]'));
      await flush();
      expect(client.isMutating()).toBe(1);
      expect(aiRenameTest.generate).toHaveBeenCalledTimes(1);
      expect(aiRenameTest.generate).toHaveBeenCalledWith({ target, id: "target" });
      await act(async () => resolve?.("Generated title"));
      await vi.waitFor(() => expect(client.isMutating()).toBe(0));
      if (target === ConversationTitleTarget.Workspace) {
        expect(aiRenameTest.setWorkspaceTitle).toHaveBeenCalledWith("target", "Generated title");
        expect(aiRenameTest.updateAgent).not.toHaveBeenCalled();
      } else {
        expect(aiRenameTest.updateAgent).toHaveBeenCalledWith("target", {
          name: "Generated title",
        });
        expect(aiRenameTest.setWorkspaceTitle).not.toHaveBeenCalled();
      }
    },
  );

  it("keeps the existing name and clears pending when generation fails", async () => {
    aiRenameTest.generate.mockRejectedValue(new Error("Model unavailable"));
    const client = renderAiRename(ConversationTitleTarget.Workspace);
    click(document.querySelector('[data-testid="ai-rename"]'));
    await vi.waitFor(() => expect(aiRenameTest.error).toHaveBeenCalledWith("Model unavailable"));
    expect(client.isMutating()).toBe(0);
    expect(aiRenameTest.setWorkspaceTitle).not.toHaveBeenCalled();
  });

  it("preserves a manual rename made during generation", async () => {
    aiRenameTest.generate.mockImplementation(async () => {
      aiRenameTest.title = "Manual title";
      return "Generated title";
    });
    renderAiRename(ConversationTitleTarget.Agent);
    click(document.querySelector('[data-testid="ai-rename"]'));
    await vi.waitFor(() => expect(aiRenameTest.error).toHaveBeenCalled());
    expect(aiRenameTest.updateAgent).not.toHaveBeenCalled();
  });

  it("gates the action for older hosts", () => {
    aiRenameTest.supported = false;
    renderAiRename(ConversationTitleTarget.Agent);
    const button = document.querySelector<HTMLButtonElement>('[data-testid="ai-rename"]');
    expect(button?.disabled).toBe(true);
  });
});
