import { describe, expect, it } from "vitest";
import type { SplitNode, WorkspaceLayout } from "@/stores/workspace-layout-store";
import { FilePaneAxis, FilePanePosition, resolveFilePanePlacement } from "./pane";
import {
  createWorkspaceFileTabTarget,
  normalizeWorkspaceFileLocation,
  resolveWorkspaceFilePaths,
  workspaceFileLocationsEqual,
} from ".";

function paneNode(id: string): SplitNode {
  return { kind: "pane", pane: { id, tabIds: [`chat-${id}`], focusedTabId: `chat-${id}` } };
}

describe.each([
  {
    axis: FilePaneAxis.Horizontal,
    forward: FilePanePosition.Right,
    backward: FilePanePosition.Left,
  },
  { axis: FilePaneAxis.Vertical, forward: FilePanePosition.Bottom, backward: FilePanePosition.Top },
])("file opens in $axis panes", ({ axis, forward, backward }) => {
  it("creates the forward split when there is one pane", () => {
    expect(
      resolveFilePanePlacement({
        layout: { root: paneNode("main"), focusedPaneId: "main" },
        sourceTabId: "chat-main",
        axis,
      }),
    ).toEqual({ sourcePaneId: "main", position: forward });
  });

  it("reuses adjacent panes and reverses direction at the far edge", () => {
    const layout: WorkspaceLayout = {
      root: {
        kind: "group",
        group: {
          id: "split",
          direction: axis,
          sizes: [0.5, 0.5],
          children: [paneNode("first"), paneNode("second")],
        },
      },
      focusedPaneId: "second",
    };
    expect(resolveFilePanePlacement({ layout, sourceTabId: "chat-first", axis })).toEqual({
      sourcePaneId: "first",
      paneId: "second",
      position: forward,
    });
    expect(resolveFilePanePlacement({ layout, sourceTabId: "chat-second", axis })).toEqual({
      sourcePaneId: "second",
      paneId: "first",
      position: backward,
    });
  });

  it("ignores the Explorer dock when choosing or creating a split", () => {
    const layout: WorkspaceLayout = {
      root: {
        kind: "group",
        group: {
          id: "dock",
          direction: "horizontal",
          sizes: [0.2, 0.8],
          children: [paneNode("explorer"), paneNode("main")],
        },
      },
      focusedPaneId: "explorer",
    };
    expect(
      resolveFilePanePlacement({
        layout,
        sourceTabId: "chat-main",
        explorerPaneId: "explorer",
        axis,
      }),
    ).toEqual({
      sourcePaneId: "main",
      position: forward,
    });
  });

  it("chooses the nearest matching pane in a nested split", () => {
    const layout: WorkspaceLayout = {
      root: {
        kind: "group",
        group: {
          id: "columns",
          direction: "horizontal",
          sizes: [0.5, 0.5],
          children: [
            paneNode("left"),
            {
              kind: "group",
              group: {
                id: "rows",
                direction: "vertical",
                sizes: [0.5, 0.5],
                children: [paneNode("top-right"), paneNode("bottom-right")],
              },
            },
          ],
        },
      },
      focusedPaneId: "left",
    };
    const expectedPane = axis === FilePaneAxis.Horizontal ? "left" : "bottom-right";
    const expectedPosition =
      axis === FilePaneAxis.Horizontal ? FilePanePosition.Left : FilePanePosition.Bottom;
    expect(resolveFilePanePlacement({ layout, sourceTabId: "chat-top-right", axis })).toEqual({
      sourcePaneId: "top-right",
      paneId: expectedPane,
      position: expectedPosition,
    });
  });
});

describe("normalizeWorkspaceFileLocation", () => {
  it("normalizes paths and valid line ranges", () => {
    expect(
      normalizeWorkspaceFileLocation({
        path: "src\\app.ts",
        lineStart: 12.8,
        lineEnd: 20.2,
      }),
    ).toEqual({
      path: "src/app.ts",
      lineStart: 12,
      lineEnd: 20,
    });
  });

  it("drops invalid or backwards line ranges", () => {
    expect(normalizeWorkspaceFileLocation({ path: "src/app.ts", lineStart: -1 })).toEqual({
      path: "src/app.ts",
    });
    expect(
      normalizeWorkspaceFileLocation({ path: "src/app.ts", lineStart: 20, lineEnd: 12 }),
    ).toEqual({
      path: "src/app.ts",
      lineStart: 20,
    });
  });

  it("rejects empty paths", () => {
    expect(normalizeWorkspaceFileLocation({ path: " " })).toBeNull();
  });
});

describe("workspace file tab targets", () => {
  it("keeps file tab identity separate from line selection", () => {
    expect(createWorkspaceFileTabTarget({ path: "src/app.ts", lineStart: 12 })).toEqual({
      kind: "file",
      path: "src/app.ts",
      lineStart: 12,
    });
  });

  it("compares full location equality", () => {
    expect(
      workspaceFileLocationsEqual(
        { path: "src/app.ts", lineStart: 12 },
        { path: "src/app.ts", lineStart: 12 },
      ),
    ).toBe(true);
    expect(
      workspaceFileLocationsEqual(
        { path: "src/app.ts", lineStart: 12 },
        { path: "src/app.ts", lineStart: 13 },
      ),
    ).toBe(false);
  });
});

describe("resolveWorkspaceFilePaths", () => {
  it("joins workspace-relative paths against the workspace root", () => {
    expect(
      resolveWorkspaceFilePaths({ path: "src/app.ts", workspaceRoot: "/Users/me/repo" }),
    ).toEqual({
      absolutePath: "/Users/me/repo/src/app.ts",
      relativePath: "src/app.ts",
    });
  });

  it("derives the relative path for an absolute file inside the workspace", () => {
    expect(
      resolveWorkspaceFilePaths({
        path: "/Users/me/repo/src/app.ts",
        workspaceRoot: "/Users/me/repo",
      }),
    ).toEqual({
      absolutePath: "/Users/me/repo/src/app.ts",
      relativePath: "src/app.ts",
    });
  });

  it("keeps the absolute path but drops the relative path when outside the workspace", () => {
    expect(
      resolveWorkspaceFilePaths({
        path: "/etc/hosts",
        workspaceRoot: "/Users/me/repo",
      }),
    ).toEqual({
      absolutePath: "/etc/hosts",
      relativePath: null,
    });
  });

  it("normalizes Windows separators in the file path", () => {
    expect(
      resolveWorkspaceFilePaths({ path: "src\\app.ts", workspaceRoot: "/Users/me/repo" }),
    ).toEqual({
      absolutePath: "/Users/me/repo/src/app.ts",
      relativePath: "src/app.ts",
    });
  });

  it("normalizes dot segments in workspace-relative paths", () => {
    expect(
      resolveWorkspaceFilePaths({ path: "./src/../app.ts", workspaceRoot: "/Users/me/repo" }),
    ).toEqual({
      absolutePath: "/Users/me/repo/app.ts",
      relativePath: "app.ts",
    });
  });

  it("rejects workspace-relative paths that escape the workspace", () => {
    expect(
      resolveWorkspaceFilePaths({ path: "../outside.ts", workspaceRoot: "/Users/me/repo" }),
    ).toBeNull();
    expect(
      resolveWorkspaceFilePaths({ path: "src/../../outside.ts", workspaceRoot: "/Users/me/repo" }),
    ).toBeNull();
  });

  it("derives the relative path for a Windows absolute file inside the workspace", () => {
    expect(
      resolveWorkspaceFilePaths({
        path: "C:\\Users\\me\\repo\\src\\app.ts",
        workspaceRoot: "C:\\Users\\me\\repo",
      }),
    ).toEqual({
      absolutePath: "C:/Users/me/repo/src/app.ts",
      relativePath: "src/app.ts",
    });
  });

  it("resolves files under a drive-root workspace without doubling the separator", () => {
    expect(resolveWorkspaceFilePaths({ path: "C:/src/app.ts", workspaceRoot: "C:\\" })).toEqual({
      absolutePath: "C:/src/app.ts",
      relativePath: "src/app.ts",
    });
    expect(resolveWorkspaceFilePaths({ path: "src/app.ts", workspaceRoot: "C:\\" })).toEqual({
      absolutePath: "C:/src/app.ts",
      relativePath: "src/app.ts",
    });
  });

  it("resolves files under the POSIX root workspace", () => {
    expect(resolveWorkspaceFilePaths({ path: "/src/app.ts", workspaceRoot: "/" })).toEqual({
      absolutePath: "/src/app.ts",
      relativePath: "src/app.ts",
    });
  });

  it("returns null for home-relative paths that cannot be anchored", () => {
    expect(
      resolveWorkspaceFilePaths({ path: "~/notes.md", workspaceRoot: "/Users/me/repo" }),
    ).toBeNull();
    expect(resolveWorkspaceFilePaths({ path: "~", workspaceRoot: "/Users/me/repo" })).toBeNull();
  });

  it("treats filenames that merely start with ~ as workspace-relative", () => {
    expect(resolveWorkspaceFilePaths({ path: "~env.ts", workspaceRoot: "/Users/me/repo" })).toEqual(
      {
        absolutePath: "/Users/me/repo/~env.ts",
        relativePath: "~env.ts",
      },
    );
  });

  it("matches Windows workspace paths case-insensitively", () => {
    expect(
      resolveWorkspaceFilePaths({
        path: "C:\\Users\\Me\\Repo\\src\\app.ts",
        workspaceRoot: "c:\\users\\me\\repo",
      }),
    ).toEqual({
      absolutePath: "C:/Users/Me/Repo/src/app.ts",
      relativePath: "src/app.ts",
    });
  });

  it("treats a case-only difference from the Windows root as the root itself", () => {
    expect(
      resolveWorkspaceFilePaths({
        path: "C:\\Users\\Me\\Repo",
        workspaceRoot: "c:\\users\\me\\repo",
      }),
    ).toBeNull();
  });

  it("returns null when the workspace root is not absolute", () => {
    expect(resolveWorkspaceFilePaths({ path: "src/app.ts", workspaceRoot: "repo" })).toBeNull();
  });

  it("returns null when the resolved file equals the workspace root", () => {
    expect(
      resolveWorkspaceFilePaths({ path: "/Users/me/repo", workspaceRoot: "/Users/me/repo" }),
    ).toBeNull();
  });
});
