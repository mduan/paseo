import "@xterm/xterm/css/xterm.css";
import { TerminalFindDirection } from "../find/direction";
import { afterEach, expect, test } from "vitest";
import {
  TerminalEmulatorRuntime,
  encodeTerminalOutput,
  type TerminalFindResult,
} from "./terminal-emulator-runtime";

let runtime: TerminalEmulatorRuntime;
let root: HTMLDivElement;
afterEach(() => {
  runtime?.unmount();
  root?.remove();
});
function mount(options?: { isMac: boolean }) {
  root = document.createElement("div");
  Object.assign(root.style, { width: "480px", height: "200px" });
  const host = document.createElement("div");
  Object.assign(host.style, { width: "100%", height: "100%" });
  root.append(host);
  document.body.append(root);
  runtime = new TerminalEmulatorRuntime(options);
  const results: TerminalFindResult[] = [];
  runtime.setCallbacks({
    callbacks: {
      onFindResult: (result) => {
        results.push(result);
      },
    },
  });
  runtime.mount({
    root,
    host,
    initialSnapshot: null,
    scrollback: 1000,
    theme: { background: "#ffffff", foreground: "#111111" },
  });
  return results;
}
function write(text: string) {
  return new Promise<void>((resolve) =>
    runtime.write({ data: encodeTerminalOutput(text), onCommitted: resolve }),
  );
}

test("uses xterm's literal matching across wrapped cells and keeps selection when Find closes", async () => {
  const results = mount();
  // Initial font measurement schedules refits through 2 seconds. Settle them
  // before choosing an exact column boundary for the wrapped text fixture.
  await new Promise((resolve) => setTimeout(resolve, 2600));
  await write("first [a.b] 界\r\n" + "padding\r\n".repeat(30) + "last [A.B] 界");
  runtime.find.search({ query: "[a.b] 界" });
  expect(results.at(-1)).toMatchObject({ resultCount: 2, resultIndex: 1, limited: false });
  runtime.find.search({ query: "[a.b] 界", direction: TerminalFindDirection.Previous });
  expect(results.at(-1)).toMatchObject({ resultCount: 2, resultIndex: 0, placement: "top" });
  runtime.find.search({ query: "[a.b] 界", direction: TerminalFindDirection.Previous });
  expect(results.at(-1)).toMatchObject({ resultCount: 2, resultIndex: 1 });
  const selection = window.__paseoTerminal!.getSelection();
  runtime.find.clear();
  expect(window.__paseoTerminal!.getSelection()).toBe(selection);
  expect(results.at(-1)).toMatchObject({ resultCount: 0, resultIndex: -1 });
  runtime.find.search({ query: "[aXb]" });
  expect(results.at(-1)).toMatchObject({ resultCount: 0 });
  const cols = window.__paseoTerminal!.cols;
  await write("\r\n" + "x".repeat(cols - 2) + "wrapped-needle");
  runtime.find.search({ query: "wrapped-needle" });
  await expect.poll(() => results.at(-1)).toMatchObject({ resultCount: 1, resultIndex: 0 });
});

test("reports the addon's highlight limit without disabling navigation beyond the counted matches", async () => {
  const results = mount();
  await write(("a ".repeat(25) + "\r\n").repeat(801));
  runtime.find.search({ query: "a" });
  expect(results.at(-1)).toMatchObject({ resultCount: 20000, limited: true, resultIndex: -1 });
  expect(window.__paseoTerminal!.getSelection()).toBe("a");
  runtime.find.search({ query: "a", direction: TerminalFindDirection.Next });
  expect(results.at(-1)).toMatchObject({ resultCount: 20000, limited: true, resultIndex: 0 });
});

test("supports literal phrases, case, Unicode word boundaries, and raw regex", async () => {
  const results = mount();
  await write(
    'bill billé ébill bill_name Bill BILL\r\nfirst a.b  word\r\nlast A.B  word\r\na.b word "axb"\r\n😀',
  );
  runtime.find.search({ query: "a.b  word" });
  expect(results.at(-1)).toMatchObject({ resultCount: 2, invalid: false });
  expect(window.__paseoTerminal!.getSelection()).toBe("A.B  word");
  runtime.find.search({ query: "a.b  word", options: { caseSensitive: true } });
  expect(results.at(-1)).toMatchObject({ resultCount: 1 });
  expect(window.__paseoTerminal!.getSelection()).toBe("a.b  word");
  runtime.find.search({ query: "bill", options: { wholeWord: true } });
  expect(results.at(-1)).toMatchObject({ resultCount: 3 });
  runtime.find.search({ query: "bill", options: { wholeWord: true, caseSensitive: true } });
  expect(results.at(-1)).toMatchObject({ resultCount: 1 });
  runtime.find.search({ query: '"a.b"', options: { regex: true } });
  expect(results.at(-1)).toMatchObject({ resultCount: 1 });
  expect(window.__paseoTerminal!.getSelection()).toBe('"axb"');
  runtime.find.search({ query: "😀", options: { regex: true } });
  expect(results.at(-1)).toMatchObject({ resultCount: 1 });
  runtime.find.search({ query: "(?=.)", options: { regex: true } });
  expect(results.at(-1)).toMatchObject({ resultCount: 0 });
  runtime.find.search({ query: "a*", options: { regex: true } });
  expect(results.at(-1)).toMatchObject({ resultCount: 6 });
});

test("clears invalid regex results and recovers when the pattern is fixed", async () => {
  const results = mount();
  await write("needle");
  runtime.find.search({ query: "needle" });
  expect(results.at(-1)).toMatchObject({ resultCount: 1, invalid: false });
  runtime.find.search({ query: "[", options: { regex: true } });
  expect(results.at(-1)).toMatchObject({ resultCount: 0, invalid: true });
  runtime.find.setWidgetSize({ width: 400, height: 58 });
  expect(results.at(-1)).toMatchObject({ resultCount: 0, invalid: true });
  runtime.find.search({ query: "needle", options: { regex: true } });
  expect(results.at(-1)).toMatchObject({ resultCount: 1, invalid: false });
  runtime.find.search({ query: "" });
  expect(results.at(-1)).toMatchObject({ resultCount: 0, invalid: false });
});

test("keeps the inspected bottom viewport fixed when output arrives", async () => {
  mount();
  await write("padding\r\n".repeat(30) + "inspected needle");
  runtime.find.search({ query: "needle" });
  const term = window.__paseoTerminal!;
  const inspected = term.buffer.active.viewportY;
  await write("\r\nnew output".repeat(30));
  await expect.poll(() => term.buffer.active.viewportY).toBe(inspected);
  expect(term.getSelection()).toBe("needle");
});

test("searches the active alternate buffer without moving the restored normal viewport", async () => {
  const results = mount();
  await write("normal needle\r\n" + "padding\r\n".repeat(30));
  const normalViewport = window.__paseoTerminal!.buffer.active.viewportY;
  await write("\x1b[?1049hAlt needle\r\nAlt NEEDLE");
  runtime.find.search({ query: "needle" });
  expect(results.at(-1)).toMatchObject({ resultCount: 2, resultIndex: 1, limited: false });
  expect(window.__paseoTerminal!.getSelection()).toBe("NEEDLE");
  runtime.find.search({ query: "needle", direction: TerminalFindDirection.Previous });
  expect(window.__paseoTerminal!.getSelection()).toBe("needle");
  await write("\x1b[?1049l");
  await expect.poll(() => window.__paseoTerminal!.buffer.active.viewportY).toBe(normalViewport);
  runtime.find.search({ query: "needle" });
  await expect.poll(() => results.at(-1)).toMatchObject({ resultCount: 1, resultIndex: 0 });
});

test("keeps Find at the top unless its measured frame covers the active match", async () => {
  const results = mount();
  await new Promise((resolve) => setTimeout(resolve, 2600));
  runtime.find.setWidgetSize({ width: 356, height: 58 });
  const cols = window.__paseoTerminal!.cols;
  await write("left-needle\r\n" + " ".repeat(cols - 12) + "right-needle");
  runtime.find.search({ query: "left-needle" });
  expect(results.at(-1)).toMatchObject({ resultCount: 1, placement: "top" });
  runtime.find.search({ query: "right-needle" });
  expect(results.at(-1)).toMatchObject({ resultCount: 1, placement: "bottom" });
});

test("closing Find cancels pending refreshes without clearing old or new selections", async () => {
  mount();
  await write("first needle\r\n" + "padding\r\n".repeat(30) + "last needle");
  const term = window.__paseoTerminal!;
  for (const freshSelection of [false, true]) {
    runtime.find.search({ query: "needle" });
    await write("\r\nnew output");
    // onWriteParsed schedules the addon's refresh after the write callback.
    await new Promise<void>((resolve) => {
      const subscription = term.onWriteParsed(() => {
        subscription.dispose();
        resolve();
      });
      runtime.write({ data: encodeTerminalOutput("\rprogress") });
    });
    runtime.find.clear();
    if (freshSelection) term.select(0, 0, 5);
    const selection = term.getSelection();
    expect(selection).toBe(freshSelection ? "first" : "needle");
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(term.getSelection()).toBe(selection);
  }
});

test("preserves inspection through multiple real parser turns of queued output", async () => {
  mount();
  await new Promise((resolve) => setTimeout(resolve, 2600));
  await write("padding\r\n".repeat(30) + "needle\r\nprogress");
  runtime.find.search({ query: "needle" });
  const term = window.__paseoTerminal!;
  const inspected = term.buffer.active.viewportY;
  const samples: { viewport: number; base: number }[] = [];
  const subscription = term.onWriteParsed(() => {
    samples.push({ viewport: term.buffer.active.viewportY, base: term.buffer.active.baseY });
  });
  for (let i = 0; i < 150; i++) {
    runtime.write({ data: encodeTerminalOutput("\rprogress".repeat(1000)) });
  }
  await write("\r\nnew output".repeat(100));
  await new Promise((resolve) => setTimeout(resolve, 350));
  subscription.dispose();
  expect(samples.length).toBeGreaterThan(1);
  expect(samples[0].base).toBe(inspected);
  expect(samples.at(-1)!.base).toBeGreaterThan(inspected);
  expect(term.buffer.active.viewportY).toBe(inspected);
  expect(term.getSelection()).toBe("needle");
});

test.each([true, false])("routes Find and shell input through xterm with isMac=%s", (isMac) => {
  mount({ isMac });
  const input: string[] = [];
  let findRequests = 0;
  runtime.setCallbacks({
    callbacks: {
      onInput: (data) => {
        input.push(data);
      },
      onFindRequest: () => {
        findRequests += 1;
      },
    },
  });
  const textarea = root.querySelector("textarea")!;
  textarea.focus();
  const ctrlF = new KeyboardEvent("keydown", {
    key: "f",
    code: "KeyF",
    keyCode: 70,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  textarea.dispatchEvent(ctrlF);
  expect(findRequests).toBe(isMac ? 0 : 1);
  expect(input).toEqual(isMac ? ["\x06"] : []);
  const metaF = new KeyboardEvent("keydown", {
    key: "f",
    code: "KeyF",
    keyCode: 70,
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  textarea.dispatchEvent(metaF);
  expect(findRequests).toBe(1);
  expect(metaF.defaultPrevented).toBe(isMac);
});
