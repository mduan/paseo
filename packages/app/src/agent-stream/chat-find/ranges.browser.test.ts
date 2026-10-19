import { createPhrasePattern } from "@getpaseo/protocol/search/phrase";
import { afterEach, expect, it } from "vitest";
import { findMessageMatches, findRenderedMatches } from "./ranges.web";

afterEach(() => {
  document.body.replaceChildren();
});
function content(html: string) {
  const row = document.createElement("div");
  row.innerHTML = `<div data-message-text="true">${html}</div>`;
  document.body.append(row);
  return row;
}
function message(messageId: string, ...blocks: string[]) {
  const root = document.createElement("div");
  for (const block of blocks) {
    const row = document.createElement("div");
    row.dataset.messageId = messageId;
    row.innerHTML = `<div data-message-text="true"><div data-paseo-markdown-tag="p">${block}</div></div>`;
    root.append(row);
  }
  document.body.append(root);
  return root;
}
it("collects a message's occurrences across its block rows in row order", () => {
  const root = message("message-1", "alpha one", "beta", "alpha two");
  const other = document.createElement("div");
  other.dataset.messageId = "message-2";
  other.innerHTML =
    '<div data-message-text="true"><div data-paseo-markdown-tag="p">alpha three</div></div>';
  root.append(other);
  expect(
    findMessageMatches(root, "message-1", createPhrasePattern({ query: "alpha" })).map((range) =>
      range.toString(),
    ),
  ).toEqual(["alpha", "alpha"]);
  expect(
    findMessageMatches(root, "message-1", createPhrasePattern({ query: "alpha" })).map(
      (range) => range.startContainer.parentElement?.textContent,
    ),
  ).toEqual(["alpha one", "alpha two"]);
  expect(
    findMessageMatches(root, "message-2", createPhrasePattern({ query: "alpha" })),
  ).toHaveLength(1);
  expect(findMessageMatches(null, "message-1", createPhrasePattern({ query: "alpha" }))).toEqual(
    [],
  );
});
it("finds each actual occurrence across inline formatting with original Unicode offsets", () => {
  const row = content(
    '<div data-paseo-markdown-tag="p">İ😀hello <strong>world</strong> then <em>hello</em> world</div>',
  );
  const matches = findRenderedMatches(row, createPhrasePattern({ query: "hello world" }));
  expect(matches.map((range) => range.toString())).toEqual(["hello world", "hello world"]);
  expect(matches[0]!.startOffset).toBe(3);
  expect(matches[0]!.compareBoundaryPoints(Range.START_TO_START, matches[1]!)).toBe(-1);
});
it("ignores controls, keeps block boundaries, and preserves literal code punctuation", () => {
  const row = content(
    '<div data-paseo-markdown-tag="p">first</div><div data-paseo-markdown-tag="p">second</div><div data-paseo-markdown-tag="pre"><span>const a</span><span>.b</span><button>copy a.b</button><span data-paseo-markdown-ignore="true">a.b</span></div>',
  );
  expect(findRenderedMatches(row, createPhrasePattern({ query: "firstsecond" }))).toEqual([]);
  expect(
    findRenderedMatches(row, createPhrasePattern({ query: "a.b" })).map((range) =>
      range.toString(),
    ),
  ).toEqual(["a.b"]);
});
it("matches whitespace across text nodes without inspecting hidden link destinations", () => {
  const row = content(
    '<div data-paseo-markdown-tag="p"><a href="https://example.com/hidden">hello &amp; world</a>\nline</div>',
  );
  expect(findRenderedMatches(row, createPhrasePattern({ query: "hidden" }))).toEqual([]);
  expect(
    findRenderedMatches(row, createPhrasePattern({ query: "world line" })).map((range) =>
      range.toString(),
    ),
  ).toEqual(["world\nline"]);
});

it("honors case, Unicode whole words, and regex across inline nodes", () => {
  const row = content(
    '<div data-paseo-markdown-tag="p">Retry <strong>retry</strong> retrying éretry retry2</div>',
  );
  const matched = (query: string, options: Parameters<typeof createPhrasePattern>[0]["options"]) =>
    findRenderedMatches(row, createPhrasePattern({ query, options })).map((range) =>
      range.toString(),
    );
  expect(matched("retry", { caseSensitive: true })).toEqual(["retry", "retry", "retry", "retry"]);
  expect(matched("retry", { wholeWord: true })).toEqual(["Retry", "retry"]);
  expect(matched("retry[0-9]+", { regex: true })).toEqual(["retry2"]);
  expect(matched("retry\\s+retry", { regex: true, wholeWord: true })).toEqual(["Retry retry"]);
  expect(matched("z*", { regex: true })).toEqual([]);
});
