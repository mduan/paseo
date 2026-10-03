import { describe, expect, it } from "vitest";
import { buildForkAgentTitle } from "./create-agent-title.js";

describe("buildForkAgentTitle", () => {
  it.each([
    ["Fix login", "(1) Fix login"],
    ["(1) Fix login", "(2) Fix login"],
    ["(8) Fix login", "(9) Fix login"],
    ["(9) Fix login", "(1) (9) Fix login"],
    ["(10) Fix login", "(1) (10) Fix login"],
    ["(2024) planning", "(1) (2024) planning"],
    ["(0) Fix login", "(1) (0) Fix login"],
    ["(3)Fix login", "(1) (3)Fix login"],
  ])("%s -> %s", (source, expected) => {
    expect(buildForkAgentTitle(source)).toBe(expected);
  });
});
