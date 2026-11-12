import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { DefaultNpmGlobalPaseoCli } from "./npm-global-cli.js";

interface CommandCall {
  command: string;
  args: string[];
  timeout?: number;
  maxBuffer?: number;
}

const globalRoot = path.join(path.sep, "global", "lib");
const globalNodeModules = path.join(globalRoot, "node_modules");
const cliPackagePath = path.join(globalNodeModules, "@mduan", "paseo-cli");

function npmGlobalPaseoCliJson(version: string, options?: { linked?: boolean }): string {
  return JSON.stringify({
    name: "lib",
    path: globalRoot,
    dependencies: {
      "@mduan/paseo-cli": {
        version,
        path: cliPackagePath,
        link: options?.linked === true,
      },
    },
  });
}

describe("DefaultNpmGlobalPaseoCli", () => {
  test("inspects and updates with the daemon's Node installation when PATH points elsewhere", async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "paseo-npm-runtime-")));
    const daemonBin = path.join(root, "daemon-bin");
    const otherBin = path.join(root, "other-bin");
    const originalExecPath = process.execPath;
    const nodeName = process.platform === "win32" ? "node.exe" : "node";
    const daemonNode = path.join(daemonBin, nodeName);
    try {
      mkdirSync(daemonBin);
      mkdirSync(otherBin);
      copyFileSync(originalExecPath, daemonNode);
      for (const bin of [daemonBin, otherBin]) {
        const installed = bin === daemonBin ? npmGlobalPaseoCliJson("0.1.15") : "{}";
        const script = `
if (process.argv.includes("install")) {
  console.log(JSON.stringify({ npmBin: ${JSON.stringify(bin)}, node: process.execPath, args: process.argv.slice(2) }));
} else {
  console.log(${JSON.stringify(installed)});
}
`;
        if (process.platform === "win32") {
          writeFileSync(path.join(bin, "npm-cli.js"), script);
          writeFileSync(path.join(bin, "npm.cmd"), '@echo off\r\nnode "%~dp0npm-cli.js" %*\r\n');
        } else {
          writeFileSync(path.join(bin, "npm"), `#!/usr/bin/env node\n${script}`, { mode: 0o755 });
        }
      }
      vi.stubEnv("PATH", [otherBin, path.dirname(originalExecPath)].join(path.delimiter));
      Object.defineProperty(process, "execPath", { value: daemonNode });
      const cli = new DefaultNpmGlobalPaseoCli();

      await expect(cli.inspect()).resolves.toEqual({
        version: "0.1.15",
        packagePath: cliPackagePath,
        globalRootPath: globalRoot,
        isLinked: false,
      });
      const result = await cli.installLatest();
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        npmBin: daemonBin,
        node: daemonNode,
        args: ["install", "-g", "@mduan/paseo-cli@latest"],
      });
    } finally {
      Object.defineProperty(process, "execPath", { value: originalExecPath });
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("inspects the npm global cli install with npm -g ls", async () => {
    const calls: CommandCall[] = [];
    const cli = new DefaultNpmGlobalPaseoCli(async (command, args, options) => {
      calls.push({
        command,
        args,
        timeout: options?.timeout,
        maxBuffer: options?.maxBuffer,
      });
      return { exitCode: 0, stdout: npmGlobalPaseoCliJson("0.1.15"), stderr: "" };
    });

    await expect(cli.inspect()).resolves.toEqual({
      version: "0.1.15",
      packagePath: cliPackagePath,
      globalRootPath: globalRoot,
      isLinked: false,
    });
    expect(calls).toEqual([
      {
        command: "npm",
        args: ["-g", "ls", "@mduan/paseo-cli", "--json", "--depth=0", "--long"],
        timeout: 10_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    ]);
  });

  test("runs the global install command for the latest cli", async () => {
    const calls: CommandCall[] = [];
    const cli = new DefaultNpmGlobalPaseoCli(async (command, args, options) => {
      calls.push({
        command,
        args,
        timeout: options?.timeout,
        maxBuffer: options?.maxBuffer,
      });
      return { exitCode: 0, stdout: "changed 42 packages", stderr: "" };
    });

    await expect(cli.installLatest()).resolves.toEqual({
      exitCode: 0,
      stdout: "changed 42 packages",
      stderr: "",
    });
    expect(calls).toEqual([
      {
        command: "npm",
        args: ["install", "-g", "@mduan/paseo-cli@latest"],
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    ]);
  });

  test("reports missing npm when npm exits without JSON", async () => {
    const cli = new DefaultNpmGlobalPaseoCli(async () => ({
      exitCode: 127,
      stdout: "",
      stderr: "npm: command not found",
    }));

    await expect(cli.inspect()).rejects.toThrow("npm: command not found");
  });

  test("reports missing global cli when npm output has no cli dependency", async () => {
    const cli = new DefaultNpmGlobalPaseoCli(async () => ({
      exitCode: 1,
      stdout: JSON.stringify({ name: "lib", path: globalRoot, dependencies: {} }),
      stderr: "missing",
    }));

    await expect(cli.inspect()).rejects.toThrow(
      "@mduan/paseo-cli is not installed with npm -g on this host",
    );
  });
});
