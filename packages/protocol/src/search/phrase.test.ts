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
  for (const query of ["(", "["]) {
    for (const wholeWord of [false, true]) {
      expect(() => createPhrasePattern({ query, options: { regex: true, wholeWord } })).toThrow(
        SearchQueryError,
      );
    }
  }
});

it("ignores zero-length regex matches in search results", () => {
  const search = createTextSearch({ query: "a*", options: { regex: true } });
  expect(search.matches(["bbb"])).toBe(false);
  expect(search.ranges("baa")).toEqual([{ start: 1, length: 2 }]);
});

it("preserves quoted substrings while keeping unquoted phrase whitespace flexible", () => {
  const pattern = createPhrasePattern({ query: 'before "a.b  word" after' });
  const text = "before\ta.b  word\nafter before a.b word after before axb  word after";
  expect([...text.matchAll(pattern)].map((match) => match[0])).toEqual([
    "before\ta.b  word\nafter",
  ]);
  expect(
    [..." a.b  word ".matchAll(createPhrasePattern({ query: '" a.b  word "' }))].map(
      (match) => match[0],
    ),
  ).toEqual([" a.b  word "]);
});

it("applies case and Unicode word boundaries to quoted phrases and leaves regex quotes literal", () => {
  const pattern = createPhrasePattern({
    query: '"Word phrase"',
    options: { caseSensitive: true, wholeWord: true },
  });
  expect(
    [..."word phrase éWord phrase Word phrase_ Word phrase!".matchAll(pattern)].map(
      (match) => match[0],
    ),
  ).toEqual(["Word phrase"]);
  const regex = createPhrasePattern({ query: '"a.b"', options: { regex: true } });
  expect([...'axb "axb" "a.b"'.matchAll(regex)].map((match) => match[0])).toEqual([
    '"axb"',
    '"a.b"',
  ]);
});

it("combines exact quoted history phrases with existing fuzzy tokens across fields", () => {
  const search = createTextSearch({ query: '"stripe billing" mian' });
  expect(search.matches(["Stripe billing export", "main"])).toBe(true);
  for (const title of ["Stripe usage billing", "Stripe  billing", "Stripe bulling"]) {
    expect(search.matches([title, "main"])).toBe(false);
  }
  expect(search.matches(["stripe", "billing", "main"])).toBe(false);
  expect(search.matches(["Stripe billing", "other"])).toBe(false);
  expect(search.ranges("Stripe billing on main")).toEqual([
    { start: 0, length: 14 },
    { start: 18, length: 4 },
  ]);
});

it("supports multiple quoted phrases, partial substrings, options, and unfinished quotes", () => {
  const search = createTextSearch({ query: '"bill" "export usage"' });
  expect(search.matches(["billing export usage"])).toBe(true);
  expect(search.matches(["bull export usage"])).toBe(false);
  const wholeWord = createTextSearch({ query: '"bill"', options: { wholeWord: true } });
  expect(wholeWord.matches(["billing"])).toBe(false);
  expect(wholeWord.matches(["Bill"])).toBe(true);
  const caseSensitive = createTextSearch({
    query: '"Bill" Paseo',
    options: { caseSensitive: true },
  });
  expect(caseSensitive.matches(["Bill", "Paseo"])).toBe(true);
  expect(caseSensitive.matches(["bill", "Paseo"])).toBe(false);
  expect(
    [...'say "hello'.matchAll(createPhrasePattern({ query: 'say "hello' }))].map(
      (match) => match[0],
    ),
  ).toEqual(['say "hello']);
});
