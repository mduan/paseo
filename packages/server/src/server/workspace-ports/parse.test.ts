import { describe, expect, it } from "vitest";
import {
  assignWorkspacePorts,
  parseLsofCwds,
  parseLsofListeners,
  parseProcessCommands,
  parseProcessParents,
  parseProcessWorkspaceIds,
  parseProcEnvironWorkspaceId,
  parseProcSockets,
  parseProcStatParent,
} from "./parse.js";

describe("workspace port parsers", () => {
  it("reads lsof process groups, IPv4, IPv6, wildcards, and multiple sockets", () => {
    expect(
      parseLsofListeners(
        "p42\ncnode\nn127.0.0.1:3000\nn[::1]:3000\np71\ncpython\nn*:8000\nninvalid\nn*:99999\n",
      ),
    ).toEqual([
      { pid: 42, processName: "node", host: "127.0.0.1", port: 3000 },
      { pid: 42, processName: "node", host: "::1", port: 3000 },
      { pid: 71, processName: "python", host: "*", port: 8000 },
    ]);
    expect(parseLsofCwds("p42\nn/work/app\np71\nn/work/app/tools\n")).toEqual(
      new Map([
        [42, "/work/app"],
        [71, "/work/app/tools"],
      ]),
    );
    expect(
      parseProcessCommands("   42 node /work/app/index.js\n71 python -m http.server\n"),
    ).toEqual(
      new Map([
        [42, "node /work/app/index.js"],
        [71, "python -m http.server"],
      ]),
    );
    expect(parseProcessParents("   42    10\n  71 42\n")).toEqual(
      new Map([
        [42, 10],
        [71, 42],
      ]),
    );
    expect(
      parseProcessWorkspaceIds(
        "  42 ssh -N -L 4848:127.0.0.1:4848 oracle-cloud PASEO_WORKSPACE_ID=wks_ssh HOME=/tmp\n  71 node server.js PASEO_WORKSPACE_ID= HOME=/tmp\n",
      ),
    ).toEqual(new Map([[42, "wks_ssh"]]));
    expect(parseProcEnvironWorkspaceId("HOME=/tmp\0PASEO_WORKSPACE_ID=wks_linux\0PATH=/bin")).toBe(
      "wks_linux",
    );
    expect(parseProcEnvironWorkspaceId("PASEO_WORKSPACE_ID=\0HOME=/tmp")).toBeUndefined();
    expect(parseProcStatParent("42 (node (v22)) S 10 10 10 0 -1")).toBe(10);
  });

  it("keeps only LISTEN rows and decodes Linux addresses in word byte order", () => {
    const fixture = `  sl  local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode
  0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000 501 0 123
  1: 00000000:1F40 00000000:0000 01 00000000:00000000 00:00000000 00000000 501 0 124
  2: 00000000000000000000000001000000:1435 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 501 0 125
  3: 00000000000000000000000000000000:1F40 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 501 0 126`;
    expect(parseProcSockets(fixture)).toEqual([
      { host: "127.0.0.1", port: 3000, inode: "123" },
      { host: "::1", port: 5173, inode: "125" },
      { host: "::", port: 8000, inode: "126" },
    ]);
    expect(parseProcSockets("malformed\n0: bad:NaN 0 0A")).toEqual([]);
  });
});

describe("assignWorkspacePorts", () => {
  const workspaces = [
    { workspaceId: "root", cwd: "/work/app" },
    { workspaceId: "nested", cwd: "/work/app/tools" },
  ];
  it("prefers the deepest cwd match, falls back to command paths, deduplicates, and drops unrelated processes", () => {
    const ports = [1, 2, 3, 4, 5, 1].map((pid) => ({ pid, host: "*", port: 3000 + pid }));
    const details = new Map([
      [1, { cwd: "/work/app/tools/src", commandLine: "node /work/app/index.js" }],
      [2, { cwd: "/outside", commandLine: "node --dir='/work/app/tools'" }],
      [3, { cwd: "/work/application", commandLine: "node /work/application/index.js" }],
      [4, { cwd: "/work/app", commandLine: "node /work/app/tools/index.js" }],
      [5, { cwd: "/outside", commandLine: "node /work/app-other/index.js" }],
    ]);
    expect(assignWorkspacePorts({ ports, details, workspaces })).toEqual([
      { pid: 1, host: "*", port: 3001, workspaceId: "nested" },
      { pid: 2, host: "*", port: 3002, workspaceId: "nested" },
      { pid: 4, host: "*", port: 3004, workspaceId: "root" },
    ]);
  });
  it("keeps distinct hosts and PIDs on the same port", () => {
    const details = new Map([
      [1, { cwd: "/work/app" }],
      [2, { cwd: "/work/app" }],
    ]);
    const ports = [
      { pid: 1, host: "::1", port: 3000 },
      { pid: 1, host: "127.0.0.1", port: 3000 },
      { pid: 2, host: "127.0.0.1", port: 3000 },
    ];
    expect(assignWorkspacePorts({ ports, details, workspaces })).toHaveLength(3);
  });

  it("isolates owned ports among same-cwd workspaces and falls back to all deepest siblings when unowned", () => {
    const sameCwdWorkspaces = [
      { workspaceId: "wks_0_sleep", cwd: "/work/scratchpad" },
      { workspaceId: "wks_5_ssh", cwd: "/work/scratchpad" },
    ];
    const ports = [
      { pid: 10, host: "127.0.0.1", port: 4848, processName: "ssh" },
      { pid: 20, host: "127.0.0.1", port: 8000, processName: "python" },
      { pid: 30, host: "127.0.0.1", port: 9000, processName: "node" },
      { pid: 40, host: "127.0.0.1", port: 9001, processName: "ssh" },
    ];
    const details = new Map([
      [10, { cwd: "/work/scratchpad", workspaceId: "wks_5_ssh" }],
      [20, { cwd: "/work/scratchpad" }],
      [30, { cwd: "/work/scratchpad", workspaceId: "wks_archived" }],
      [40, { cwd: "/tmp", workspaceId: "wks_5_ssh" }],
    ]);
    expect(assignWorkspacePorts({ ports, details, workspaces: sameCwdWorkspaces })).toEqual([
      { pid: 20, host: "127.0.0.1", port: 8000, processName: "python", workspaceId: "wks_0_sleep" },
      { pid: 30, host: "127.0.0.1", port: 9000, processName: "node", workspaceId: "wks_0_sleep" },
      { pid: 10, host: "127.0.0.1", port: 4848, processName: "ssh", workspaceId: "wks_5_ssh" },
      { pid: 20, host: "127.0.0.1", port: 8000, processName: "python", workspaceId: "wks_5_ssh" },
      { pid: 30, host: "127.0.0.1", port: 9000, processName: "node", workspaceId: "wks_5_ssh" },
      { pid: 40, host: "127.0.0.1", port: 9001, processName: "ssh", workspaceId: "wks_5_ssh" },
    ]);
  });
});
