/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { highlightToKeyedLines } from "@/utils/highlight-cache";
import { HighlightedLines } from "./highlighted-content";

// The unistyles test stub theme has no syntax colors.
vi.mock("@/styles/syntax-token-styles", () => ({ syntaxTokenStyleFor: () => undefined }));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// A line with no text collapses to zero height in the gutterless view, so it
// must carry a placeholder character.
it("keeps a placeholder in blank lines of the gutterless view", () => {
  const lines = highlightToKeyedLines("const a = 1;\n\nconst b = 2;", "ts");
  if (!lines) throw new Error("expected ts to highlight");

  act(() => root.render(<HighlightedLines lines={lines} />));

  const lineTexts = Array.from(container.firstElementChild?.children ?? [], (el) => el.textContent);
  expect(lineTexts).toEqual(["const a = 1;", "​", "const b = 2;"]);
});
