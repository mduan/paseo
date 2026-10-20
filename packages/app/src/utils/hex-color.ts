export interface HsvColor {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  v: number;
}

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

/** Accepts `3a7bd5` or `#3A7BD5`; returns lowercase `#rrggbb`, or undefined. */
export function parseHexColor(input: string): string | undefined {
  const trimmed = input.trim().toLowerCase();
  const hex = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return HEX_COLOR_PATTERN.test(hex) ? hex : undefined;
}

function hexChannels(hex: string): [number, number, number] {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

export function hsvToHex({ h, s, v }: HsvColor): string {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    const value = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

export function hexToHsv(hex: string): HsvColor {
  const [r, g, b] = hexChannels(hex);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  return { h: (hue * 60 + 360) % 360, s: max === 0 ? 0 : delta / max, v: max };
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexChannels(hex).map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const DARK_LETTER = "#1a1a1a";
const LIGHT_LETTER = "#ffffff";

/**
 * The letter drawn on a colored icon. White, unless the fill is light enough that white drops
 * below 3:1 — the WCAG floor for large text, which the single initial is.
 */
export function readableLetterColor(fillHex: string): string {
  const contrastWithWhite = 1.05 / (relativeLuminance(fillHex) + 0.05);
  return contrastWithWhite < 3 ? DARK_LETTER : LIGHT_LETTER;
}
