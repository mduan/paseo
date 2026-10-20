import { expect, it } from "vitest";
import { createPhrasePattern } from "./phrase.js";
import { createTextSearch, SearchQueryError } from "./query.js";

it("matches literal phrases across whitespace with the requested case", () => {
  const query = "a.b word";
  expect(
    [..."A.B\nword axb word".matchAll(createPhrasePattern({ query }))].map((m) => m[0]),
  ).toEqual(["A.B\nword"]);
  expect(
    [
      ..."A.B word a.b word".matchAll(
        createPhrasePattern({ query, options: { caseSensitive: true } }),
      ),
    ].map((m) => m[0]),
  ).toEqual(["a.b word"]);
});

it("shares Unicode whole-word boundaries with history search", () => {
  const options = { wholeWord: true };
  const text = "word sword word_ word2 éword wordé word\u0301 word!";
  expect(
    [...text.matchAll(createPhrasePattern({ query: "word", options }))].map((m) => m[0]),
  ).toEqual(["word", "word"]);
  expect(createTextSearch({ query: "word", options }).ranges(text)).toEqual([
    { start: 0, length: 4 },
    { start: 41, length: 4 },
  ]);
});

it("supports raw regex and reports invalid expressions", () => {
  expect(
    [
      ..."retry1 Retry22".matchAll(
        createPhrasePattern({ query: "retry\\d+", options: { regex: true } }),
      ),
    ].map((m) => m[0]),
  ).toEqual(["retry1", "Retry22"]);
  expect(() => createPhrasePattern({ query: "(", options: { regex: true } })).toThrow(
    SearchQueryError,
  );
});

it("ignores zero-length regex matches in search results", () => {
  const search = createTextSearch({ query: "a*", options: { regex: true } });
  expect(search.matches(["bbb"])).toBe(false);
  expect(search.ranges("baa")).toEqual([{ start: 1, length: 2 }]);
});
