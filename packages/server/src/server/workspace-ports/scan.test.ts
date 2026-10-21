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
    const ports = await scanListeningPorts({ details, logger });
    expect(ports).toEqual([{ pid: 42, host: "127.0.0.1", port: 3000, processName: "node" }]);
    expect(details.get(42)).toEqual({ cwd: "/work/app", commandLine: "node /work/app/server.js" });
    expect(command.mock.calls.map(([name, args]) => [name, args])).toEqual([
      ["lsof", ["-b", "-w", "-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"]],
      ["lsof", ["-b", "-w", "-a", "-p", "42", "-d", "cwd", "-Fn"]],
      ["ps", ["-p", "42", "-o", "pid=", "-o", "command="]],
    ]);
    for (const call of command.mock.calls) expect(call[2]?.timeout).toBe(5000);
    command.mockResolvedValueOnce({ stdout: "p42\ncnode\nn*:3000\n", stderr: "" });
    await scanListeningPorts({ details, logger });
    expect(command).toHaveBeenCalledTimes(4);
    command.mockResolvedValueOnce({ stdout: "", stderr: "" });
    expect(await scanListeningPorts({ details, logger })).toEqual([]);
    expect(details.size).toBe(0);
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
});
