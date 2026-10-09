import { describe, expect, it, vi } from "vitest";
import { BrowserWindow, Menu, clipboard, shell } from "electron";
import { EventEmitter } from "node:events";

vi.mock("electron", () => ({
  BrowserWindow: class {
    webContents = Object.assign(new EventEmitter(), {
      copyImageAt: vi.fn(),
      downloadURL: vi.fn(),
    });
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })),
  },
  clipboard: { writeText: vi.fn() },
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
}));

import {
  applyMacWindowControlsUpdate,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  getMainWindowChromeOptions,
  readBadgeCount,
  readWindowChromeUpdate,
  readWindowTheme,
  resolveWindowBounds,
  setupDefaultContextMenu,
} from "./window-manager";

describe("window-manager", () => {
  describe("setupDefaultContextMenu", () => {
    it("does not open a native menu outside inputs when no text is selected", () => {
      vi.mocked(Menu.buildFromTemplate).mockClear();
      const win = new BrowserWindow();
      setupDefaultContextMenu(win);

      win.webContents.emit("context-menu", {}, { isEditable: false, selectionText: "" });

      expect(Menu.buildFromTemplate).not.toHaveBeenCalled();
    });

    it("offers only native Copy for selected text", () => {
      vi.mocked(Menu.buildFromTemplate).mockClear();
      const win = new BrowserWindow();
      setupDefaultContextMenu(win);

      win.webContents.emit(
        "context-menu",
        {},
        {
          isEditable: false,
          selectionText: "Selected",
        },
      );

      expect(Menu.buildFromTemplate).toHaveBeenCalledWith([{ role: "copy" }]);
      const menu = vi.mocked(Menu.buildFromTemplate).mock.results[0]!.value;
      expect(menu.popup).toHaveBeenCalledWith({ window: win });
    });

    it.each(["", "Selected"])(
      "offers only link actions when selected text is %j",
      (selectionText) => {
        vi.mocked(Menu.buildFromTemplate).mockClear();
        vi.mocked(clipboard.writeText).mockClear();
        vi.mocked(shell.openExternal).mockClear();
        const win = new BrowserWindow();
        setupDefaultContextMenu(win);
        const linkURL = "https://example.com";

        win.webContents.emit("context-menu", {}, { isEditable: false, linkURL, selectionText });

        expect(Menu.buildFromTemplate).toHaveBeenCalledWith([
          { label: "Open Link in Browser", click: expect.any(Function) },
          { label: "Copy Link Address", click: expect.any(Function) },
        ]);
        const items = vi.mocked(Menu.buildFromTemplate).mock.calls[0]![0];
        Reflect.apply(items[0]!.click!, undefined, []);
        Reflect.apply(items[1]!.click!, undefined, []);
        expect(shell.openExternal).toHaveBeenCalledWith(linkURL);
        expect(clipboard.writeText).toHaveBeenCalledWith(linkURL);
      },
    );

    it("offers only image actions, even for linked images with selected text", () => {
      vi.mocked(Menu.buildFromTemplate).mockClear();
      const win = new BrowserWindow();
      setupDefaultContextMenu(win);
      const srcURL = "https://example.com/image.png";

      win.webContents.emit(
        "context-menu",
        {},
        {
          isEditable: false,
          hasImageContents: true,
          srcURL,
          linkURL: "https://example.com",
          selectionText: "Selected",
          x: 20,
          y: 30,
        },
      );

      expect(Menu.buildFromTemplate).toHaveBeenCalledWith([
        { label: "Copy Image", click: expect.any(Function) },
        { label: "Save Image As…", click: expect.any(Function) },
      ]);
      const items = vi.mocked(Menu.buildFromTemplate).mock.calls[0]![0];
      Reflect.apply(items[0]!.click!, undefined, []);
      Reflect.apply(items[1]!.click!, undefined, []);
      expect(win.webContents.copyImageAt).toHaveBeenCalledWith(20, 30);
      expect(win.webContents.downloadURL).toHaveBeenCalledWith(srcURL);
    });

    it("preserves the native editing menu for inputs", () => {
      vi.mocked(Menu.buildFromTemplate).mockClear();
      const win = new BrowserWindow();
      setupDefaultContextMenu(win);

      win.webContents.emit(
        "context-menu",
        {},
        {
          isEditable: true,
          editFlags: { canCut: true, canCopy: true, canPaste: true },
        },
      );

      expect(Menu.buildFromTemplate).toHaveBeenCalledWith([
        { role: "cut", enabled: true },
        { role: "copy", enabled: true },
        { role: "paste", enabled: true },
        { type: "separator" },
        { role: "selectAll" },
      ]);
      const menu = vi.mocked(Menu.buildFromTemplate).mock.results[0]!.value;
      expect(menu.popup).toHaveBeenCalledWith({ window: win });
    });
  });

  describe("readBadgeCount", () => {
    it("returns valid non-negative integers", () => {
      expect(readBadgeCount(0)).toBe(0);
      expect(readBadgeCount(3)).toBe(3);
    });

    it("falls back to zero for invalid payloads", () => {
      expect(readBadgeCount(undefined)).toBe(0);
      expect(readBadgeCount(null)).toBe(0);
      expect(readBadgeCount(Number.NaN)).toBe(0);
      expect(readBadgeCount(Number.POSITIVE_INFINITY)).toBe(0);
      expect(readBadgeCount(-1)).toBe(0);
      expect(readBadgeCount(1.5)).toBe(0);
      expect(readBadgeCount("2")).toBe(0);
      expect(readBadgeCount({ count: 2 })).toBe(0);
    });
  });

  describe("readWindowTheme", () => {
    it("accepts supported title bar themes", () => {
      expect(readWindowTheme("light")).toBe("light");
      expect(readWindowTheme("dark")).toBe("dark");
    });

    it("rejects invalid title bar themes", () => {
      expect(readWindowTheme(undefined)).toBeNull();
      expect(readWindowTheme("auto")).toBeNull();
      expect(readWindowTheme("system")).toBeNull();
    });
  });

  describe("readWindowChromeUpdate", () => {
    it("accepts partial runtime overlay updates", () => {
      expect(
        readWindowChromeUpdate({
          backgroundColor: "#181B1A",
          trafficLightOffsetY: -5,
        }),
      ).toEqual({
        backgroundColor: "#181B1A",
        trafficLightOffsetY: -5,
      });
    });

    it("rejects empty and invalid payloads", () => {
      expect(readWindowChromeUpdate(undefined)).toBeNull();
      expect(readWindowChromeUpdate({})).toBeNull();
      expect(readWindowChromeUpdate({ backgroundColor: 12 })).toBeNull();
      expect(readWindowChromeUpdate({ trafficLightOffsetY: -11 })).toBeNull();
    });

    it("preserves fractional traffic-light offsets", () => {
      expect(readWindowChromeUpdate({ trafficLightOffsetY: 1.5 })).toEqual({
        trafficLightOffsetY: 1.5,
      });
    });
  });

  describe("applyMacWindowControlsUpdate", () => {
    it("uses the focus and normal traffic-light positions", () => {
      const setWindowButtonPosition = vi.fn();

      applyMacWindowControlsUpdate({
        win: { setWindowButtonPosition },
        update: { trafficLightOffsetY: -5 },
      });
      applyMacWindowControlsUpdate({
        win: { setWindowButtonPosition },
        update: { trafficLightOffsetY: 0.5 },
      });

      expect(setWindowButtonPosition).toHaveBeenNthCalledWith(1, { x: 16, y: 9 });
      expect(setWindowButtonPosition).toHaveBeenNthCalledWith(2, { x: 16, y: 14.5 });
    });
  });

  describe("getMainWindowChromeOptions", () => {
    it("uses renderer-painted controls on windows", () => {
      expect(
        getMainWindowChromeOptions({
          mode: "custom-windows",
        }),
      ).toEqual({
        frame: false,
        autoHideMenuBar: true,
      });
    });

    it("uses renderer-painted controls on linux", () => {
      expect(
        getMainWindowChromeOptions({
          mode: "custom-linux",
        }),
      ).toEqual({
        frame: false,
        autoHideMenuBar: true,
      });
    });

    it("keeps the mac traffic-light path separate", () => {
      expect(
        getMainWindowChromeOptions({
          mode: "native-mac",
        }),
      ).toEqual({
        titleBarStyle: "hidden",
        titleBarOverlay: true,
        trafficLightPosition: { x: 16, y: 14 },
      });
    });
  });

  describe("resolveWindowBounds", () => {
    it("falls back to the default size when no state is saved", () => {
      expect(resolveWindowBounds(null)).toEqual({
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
      });
    });

    it("restores the full size and position", () => {
      expect(
        resolveWindowBounds({ x: 120, y: 80, width: 1024, height: 720, isMaximized: false }),
      ).toEqual({ width: 1024, height: 720, x: 120, y: 80 });
    });

    it("omits the position when only the size was persisted", () => {
      expect(resolveWindowBounds({ width: 1024, height: 720, isMaximized: true })).toEqual({
        width: 1024,
        height: 720,
      });
    });
  });
});
