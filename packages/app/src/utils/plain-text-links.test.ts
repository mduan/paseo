import { describe, expect, it } from "vitest";
import { splitPlainTextLinks } from "./plain-text-links";

describe("splitPlainTextLinks", () => {
  it("links prompt URLs while preserving whitespace, Markdown, and trailing punctuation", () => {
    const prompt =
      "**explore** (https://linear.app/mixpanel/issue/COR-1239).\nThen https://paseo.sh/docs?q=a&b=c!";

    const parts = splitPlainTextLinks(prompt);

    expect(parts).toEqual([
      { start: 0, text: "**explore** (" },
      {
        start: 13,
        text: "https://linear.app/mixpanel/issue/COR-1239",
        href: "https://linear.app/mixpanel/issue/COR-1239",
      },
      { start: 55, text: ").\nThen " },
      { start: 63, text: "https://paseo.sh/docs?q=a&b=c", href: "https://paseo.sh/docs?q=a&b=c" },
      { start: 92, text: "!" },
    ]);
    expect(parts.map((part) => part.text).join("")).toBe(prompt);
  });

  it("uses the detector's normalized target for bare domains", () => {
    expect(splitPlainTextLinks("see www.paseo.sh")).toEqual([
      { start: 0, text: "see " },
      { start: 4, text: "www.paseo.sh", href: "http://www.paseo.sh" },
    ]);
  });

  it("leaves unsupported schemes and email addresses as plain text", () => {
    const prompt = "javascript:alert(1) file:///tmp/a.ts ftp://paseo.sh user@example.com";

    expect(splitPlainTextLinks(prompt)).toEqual([{ start: 0, text: prompt }]);
  });

  it("keeps plain prompts unchanged", () => {
    expect(splitPlainTextLinks('  run --name="my repo"\n')).toEqual([
      { start: 0, text: '  run --name="my repo"\n' },
    ]);
    expect(splitPlainTextLinks("")).toEqual([]);
  });
});
