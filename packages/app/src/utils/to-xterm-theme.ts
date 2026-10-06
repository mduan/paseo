import type { ITheme } from "@xterm/xterm";
import { UnistylesRuntime } from "react-native-unistyles";

import type { Theme } from "@/styles/theme";

type TerminalPalette = Theme["colors"]["terminal"];

export function toXtermTheme(terminal: TerminalPalette): ITheme {
  return {
    background: terminal.background,
    foreground: terminal.foreground,
    cursor: terminal.cursor,
    cursorAccent: terminal.cursorAccent,
    selectionBackground: terminal.selectionBackground,
    selectionForeground: terminal.selectionForeground,
    black: terminal.black,
    red: terminal.red,
    green: terminal.green,
    yellow: terminal.yellow,
    blue: terminal.blue,
    magenta: terminal.magenta,
    cyan: terminal.cyan,
    white: terminal.white,

    brightBlack: terminal.brightBlack,
    brightRed: terminal.brightRed,
    brightGreen: terminal.brightGreen,
    brightYellow: terminal.brightYellow,
    brightBlue: terminal.brightBlue,
    brightMagenta: terminal.brightMagenta,
    brightCyan: terminal.brightCyan,
    brightWhite: terminal.brightWhite,
  };
}

// Read at create time: the daemon answers the new terminal's color queries with these, so
// Codex and similar TUIs choose a palette matching the current light or dark theme.
export function getTerminalQueryColors(): { foreground: string; background: string } {
  const { foreground, background } = UnistylesRuntime.getTheme().colors.terminal;
  return { foreground, background };
}
