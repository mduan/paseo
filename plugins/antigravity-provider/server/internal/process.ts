import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { signalProcess } from "./signals.js";
import type { ProviderLaunch, ProviderSessionConfig } from "@getpaseo/plugin/server/provider";
import { AntigravityError, diagnostic } from "./errors.js";

export function selection(config: ProviderSessionConfig): string {
  return JSON.stringify([config.model, config.mode]);
}

function signalGroup(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void | Promise<void> {
  if (!child.pid) return;
  return signalProcess({ platform: process.platform, pid: child.pid, signal });
}

interface ProbeOptions {
  launch: ProviderLaunch;
  args: string[];
  cwd?: string;
}
export function probe(options: ProbeOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.launch.command, [...options.launch.args, ...options.args], {
      env: options.launch.env,
      cwd: options.cwd,
      stdio: "pipe",
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    const deadline = setTimeout(() => {
      const termination = Promise.resolve(signalGroup(child, "SIGKILL"));
      void termination.then(() => {
        reject(new AntigravityError("Antigravity discovery timed out", "PROBE_TIMEOUT"));
        return undefined;
      }, reject);
    }, 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8192);
    });
    child.on("error", (error: Error) => {
      clearTimeout(deadline);
      reject(new AntigravityError(error.message, "SPAWN_ERROR"));
    });
    child.on("close", (code) => {
      clearTimeout(deadline);
      if (code === 0) resolve(stdout);
      else
        reject(
          new AntigravityError(
            diagnostic(stderr.trim() || `agy exited with code ${code}`),
            "PROBE_ERROR",
          ),
        );
    });
  });
}
