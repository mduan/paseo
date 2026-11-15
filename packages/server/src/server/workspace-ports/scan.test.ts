import { readdir, readFile, readlink } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import { execCommand } from "../../utils/spawn.js";
import { scanListeningPorts } from "./scan.js";
import type { ProcessDetails } from "./parse.js";

vi.mock("../../utils/spawn.js", () => ({ execCommand: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readdir: vi.fn(), readFile: vi.fn(), readlink: vi.fn() }));
const command = vi.mocked(execCommand);
const logger = pino({ level: "silent" });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("macOS port scanner", () => {
  function macOS() {
    vi.stubGlobal("process", Object.create(process, { platform: { value: "darwin" } }));
  }

  it("uses bounded commands, caches PID metadata, and drops departed processes", async () => {
    macOS();
    const details = new Map<number, ProcessDetails>();
    command.mockResolvedValueOnce({ stdout: "p42\ncnode\nn127.0.0.1:3000\n", stderr: "" });
    command.mockResolvedValueOnce({ stdout: "p42\nn/work/app\n", stderr: "" });
    command.mockResolvedValueOnce({ stdout: "42 node /work/app/server.js\n", stderr: "" });
    command.mockResolvedValueOnce({ stdout: "42 1\n", stderr: "" });
    command.mockResolvedValueOnce({
      stdout: "42 node /work/app/server.js PASEO_WORKSPACE_ID=wks_app\n",
      stderr: "",
    });
    const ports = await scanListeningPorts({ details, logger });
    expect(ports).toEqual([{ pid: 42, host: "127.0.0.1", port: 3000, processName: "node" }]);
    expect(details.get(42)).toEqual({
      cwd: "/work/app",
      commandLine: "node /work/app/server.js",
      workspaceId: "wks_app",
    });
    expect(command.mock.calls.map(([name, args]) => [name, args])).toEqual([
      ["lsof", ["-b", "-w", "-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"]],
      ["lsof", ["-b", "-w", "-a", "-p", "42", "-d", "cwd", "-Fn"]],
      ["ps", ["-p", "42", "-o", "pid=", "-o", "command="]],
      ["ps", ["-e", "-o", "pid=,ppid="]],
      ["ps", ["-p", "42", "-ww", "-E", "-o", "pid=,command="]],
    ]);
    for (const call of command.mock.calls) expect(call[2]?.timeout).toBe(5000);
    command.mockResolvedValueOnce({ stdout: "p42\ncnode\nn*:3000\n", stderr: "" });
    await scanListeningPorts({ details, logger });
    expect(command).toHaveBeenCalledTimes(6);
    command.mockResolvedValueOnce({ stdout: "", stderr: "" });
    expect(await scanListeningPorts({ details, logger })).toEqual([]);
    expect(details.size).toBe(0);
  });

  it("attributes SIP-protected terminal children via processOwners without ps -E and checks ancestor env otherwise", async () => {
    macOS();
    const details = new Map<number, ProcessDetails>();
    command.mockResolvedValueOnce({
      stdout: "p42\ncssh\nn127.0.0.1:4848\np71\ncssh\nn127.0.0.1:5000\n",
      stderr: "",
    });
    command.mockResolvedValueOnce({
      stdout: "p42\nn/work/scratchpad\np71\nn/work/scratchpad\n",
      stderr: "",
    });
    command.mockResolvedValueOnce({
      stdout: "42 ssh -N -L 4848:127.0.0.1:4848 host\n71 ssh -N -L 5000:127.0.0.1:5000 host\n",
      stderr: "",
    });
    command.mockResolvedValueOnce({
      stdout: `42 10\n10 5\n5 ${process.pid}\n71 60\n60 ${process.pid}\n`,
      stderr: "",
    });
    command.mockResolvedValueOnce({
      stdout: "60 claude PASEO_WORKSPACE_ID=wks_agent\n71 ssh -N -L 5000:127.0.0.1:5000 host\n",
      stderr: "",
    });

    await scanListeningPorts({
      details,
      logger,
      processOwners: new Map([[5, "wks_terminal"]]),
    });

    expect(details.get(42)).toEqual({
      cwd: "/work/scratchpad",
      commandLine: "ssh -N -L 4848:127.0.0.1:4848 host",
      workspaceId: "wks_terminal",
    });
    expect(details.get(71)).toEqual({
      cwd: "/work/scratchpad",
      commandLine: "ssh -N -L 5000:127.0.0.1:5000 host",
      workspaceId: "wks_agent",
    });
    expect(command.mock.calls[4]?.[1]).toEqual(["-p", "71,60", "-ww", "-E", "-o", "pid=,command="]);
  });

  it("logs command failure and returns empty without retaining stale metadata", async () => {
    macOS();
    const warn = vi.spyOn(logger, "warn");
    const details = new Map([[42, { cwd: "/work/app" }]]);
    command.mockRejectedValueOnce(new Error("timed out"));
    expect(await scanListeningPorts({ details, logger })).toEqual([]);
    expect(details.size).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it("returns no listeners on unsupported platforms without spawning commands", async () => {
    vi.stubGlobal("process", Object.create(process, { platform: { value: "win32" } }));
    expect(await scanListeningPorts({ details: new Map(), logger })).toEqual([]);
    expect(command).not.toHaveBeenCalled();
  });
});

describe("Linux port scanner", () => {
  it("maps LISTEN socket inodes to PIDs, tolerates private processes, and caches metadata", async () => {
    vi.stubGlobal("process", Object.create(process, { platform: { value: "linux" } }));
    const missing = Object.assign(new Error("gone or private"), { code: "ENOENT" });
    const files: Record<string, string> = {
      "/proc/net/tcp":
        "0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000 501 0 123",
      "/proc/42/comm": "node\n",
      "/proc/42/cmdline": "node\0/work/app/server.js\0",
    };
    vi.mocked(readFile).mockImplementation(async (file) => {
      const contents = files[String(file)];
      if (contents === undefined) throw missing;
      return contents;
    });
    vi.mocked(readdir).mockImplementation(async (directory) => {
      if (String(directory) === "/proc") return ["net", "42", "71"];
      if (String(directory) === "/proc/42/fd") return ["1", "2", "3"];
      throw missing;
    });
    vi.mocked(readlink).mockImplementation(async (link) => {
      if (String(link) === "/proc/42/cwd") return "/work/app";
      if (String(link) === "/proc/42/fd/1") return "socket:[123]";
      if (String(link) === "/proc/42/fd/2") return "socket:[999]";
      throw missing;
    });
    const details = new Map<number, ProcessDetails>([[99, { cwd: "/old" }]]);
    expect(await scanListeningPorts({ details, logger })).toEqual([
      { pid: 42, host: "127.0.0.1", port: 3000, processName: "node" },
    ]);
    expect(details.get(42)).toEqual({ cwd: "/work/app", commandLine: "node /work/app/server.js " });
    expect(details.has(99)).toBe(false);
    vi.mocked(readFile).mockClear();
    vi.mocked(readlink).mockClear();
    await scanListeningPorts({ details, logger });
    expect(readFile).not.toHaveBeenCalledWith("/proc/42/cmdline", "utf8");
    expect(readlink).not.toHaveBeenCalledWith("/proc/42/cwd");
    expect(command).not.toHaveBeenCalled();
  });

  it("reads Linux workspace ownership from /proc environ and ancestor stat", async () => {
    vi.stubGlobal("process", Object.create(process, { platform: { value: "linux" } }));
    const missing = Object.assign(new Error("gone or private"), { code: "ENOENT" });
    const files: Record<string, string> = {
      "/proc/net/tcp":
        "0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000 501 0 123\n1: 0100007F:12F0 00000000:0000 0A 00000000:00000000 00:00000000 00000000 501 0 124",
      "/proc/42/comm": "node\n",
      "/proc/42/cmdline": "node\0server.js\0",
      "/proc/42/environ": "HOME=/tmp\0PASEO_WORKSPACE_ID=wks_env\0",
      "/proc/71/comm": "ssh\n",
      "/proc/71/cmdline": "ssh\0-N\0",
      "/proc/71/environ": "HOME=/tmp\0",
      "/proc/71/stat": "71 (ssh) S 10 10 10 0 -1",
    };
    vi.mocked(readFile).mockImplementation(async (file) => {
      const contents = files[String(file)];
      if (contents === undefined) throw missing;
      return contents;
    });
    vi.mocked(readdir).mockImplementation(async (directory) => {
      if (String(directory) === "/proc") return ["42", "71"];
      if (String(directory) === "/proc/42/fd") return ["1"];
      if (String(directory) === "/proc/71/fd") return ["1"];
      throw missing;
    });
    vi.mocked(readlink).mockImplementation(async (link) => {
      if (String(link) === "/proc/42/cwd") return "/work/scratchpad";
      if (String(link) === "/proc/42/fd/1") return "socket:[123]";
      if (String(link) === "/proc/71/cwd") return "/work/scratchpad";
      if (String(link) === "/proc/71/fd/1") return "socket:[124]";
      throw missing;
    });

    const details = new Map<number, ProcessDetails>();
    await scanListeningPorts({
      details,
      logger,
      processOwners: new Map([[10, "wks_terminal"]]),
    });

    expect(details.get(42)?.workspaceId).toBe("wks_env");
    expect(details.get(71)?.workspaceId).toBe("wks_terminal");
  });
});
