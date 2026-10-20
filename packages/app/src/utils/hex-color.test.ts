import { describe, expect, it } from "vitest";
import { IDENTITY_COLOR_NAMES, identityColor } from "@/styles/identity-colors";
import { hexToHsv, hsvToHex, parseHexColor, readableLetterColor } from "./hex-color";

describe("parseHexColor", () => {
  it("normalizes case and a missing hash", () => {
    expect(parseHexColor(" 3A7BD5 ")).toBe("#3a7bd5");
    expect(parseHexColor("#3a7bd5")).toBe("#3a7bd5");
  });

  it("rejects anything but six hex digits", () => {
    expect(parseHexColor("#abc")).toBeUndefined();
    expect(parseHexColor("teal")).toBeUndefined();
    expect(parseHexColor("#3a7bd5ff")).toBeUndefined();
  });
});

describe("hsv conversion", () => {
  it("round-trips a hex value", () => {
    for (const hex of ["#3a7bd5", "#000000", "#ffffff", "#ff0000", "#7a6aa8"]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });
});

describe("readableLetterColor", () => {
  it("keeps every preset white", () => {
    for (const name of IDENTITY_COLOR_NAMES) {
      expect(readableLetterColor(identityColor(name))).toBe("#ffffff");
    }
  });

  it("switches to a dark letter on light fills", () => {
    expect(readableLetterColor("#ffeb3b")).toBe("#1a1a1a");
    expect(readableLetterColor("#ffffff")).toBe("#1a1a1a");
  });
});
