import { buildSshCommandArgs } from "@getpaseo/protocol/ssh-transport";
import { execCommand } from "@getpaseo/server/process";
import { parseTransportTarget, type SshTransportTarget } from "./local-transport.js";

const FORK_CLI_PACKAGE = "@mduan/paseo-cli";
const UPSTREAM_CLI_PACKAGE = "@getpaseo/cli";
const OUTPUT_DETAIL_LIMIT = 4000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

// The renderer picks one of these operations; main builds the command, so the
// renderer can never run an arbitrary command on a Remote SSH host.
export enum RemoteSshDaemonOperation {
  // Replaces whatever CLI the host has with the fork package, then restarts the
  // daemon. A worker restart cannot switch packages, so this stops and starts it.
  InstallForkDaemon = "install_fork_daemon",
  StartDaemon = "start_daemon",
}

const OPERATION_TIMEOUT_MS: Record<RemoteSshDaemonOperation, number> = {
  [RemoteSshDaemonOperation.InstallForkDaemon]: 10 * 60_000,
  [RemoteSshDaemonOperation.StartDaemon]: 2 * 60_000,
};

export function buildRemoteSshDaemonCommand(operation: RemoteSshDaemonOperation): string {
  switch (operation) {
    case RemoteSshDaemonOperation.InstallForkDaemon:
      // npm refuses to overwrite the `paseo` bin another package owns, so the
      // upstream CLI goes first. Uninstalling a missing package is a no-op, and
      // stopping a daemon that is not running is not an error here.
      return [
        `npm uninstall -g ${UPSTREAM_CLI_PACKAGE};`,
        `npm install -g ${FORK_CLI_PACKAGE}@latest`,
        "&& (paseo daemon stop; paseo daemon start)",
      ].join(" ");
    case RemoteSshDaemonOperation.StartDaemon:
      return "paseo daemon start";
  }
}

function parseOperation(value: unknown): RemoteSshDaemonOperation {
  const operations: unknown[] = Object.values(RemoteSshDaemonOperation);
  if (!operations.includes(value)) {
    throw new Error("Unsupported Remote SSH daemon operation.");
  }
  return value as RemoteSshDaemonOperation;
}

export function parseRemoteSshDaemonOperationInput(value: unknown): {
  target: SshTransportTarget;
  operation: RemoteSshDaemonOperation;
} {
  if (typeof value !== "object" || value === null) {
    throw new Error("Remote SSH daemon operation input must be an object.");
  }
  const input = value as { target?: unknown; operation?: unknown };
  const target = parseTransportTarget(input.target);
  if (target.transportType !== "ssh") {
    throw new Error("Remote SSH daemon operations need a Remote SSH host.");
  }
  return { target, operation: parseOperation(input.operation) };
}

export function buildRemoteSshDaemonArgs(input: {
  target: SshTransportTarget;
  operation: RemoteSshDaemonOperation;
}): string[] {
  return buildSshCommandArgs({
    host: input.target.host,
    ...(input.target.sshPort !== undefined ? { sshPort: input.target.sshPort } : {}),
    command: buildRemoteSshDaemonCommand(input.operation),
  });
}

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > OUTPUT_DETAIL_LIMIT ? `…${trimmed.slice(-OUTPUT_DETAIL_LIMIT)}` : trimmed;
}

export function describeRemoteSshDaemonFailure(error: unknown, timeoutMs: number): string {
  const failure = (error ?? {}) as {
    stderr?: unknown;
    stdout?: unknown;
    killed?: unknown;
    message?: unknown;
  };
  const stderr = typeof failure.stderr === "string" ? tail(failure.stderr) : "";
  const stdout = typeof failure.stdout === "string" ? tail(failure.stdout) : "";
  const timedOut = failure.killed === true;
  const prefix = timedOut ? `Timed out after ${Math.round(timeoutMs / 60_000)} minutes.` : "";
  const detail = stderr || stdout || (typeof failure.message === "string" ? failure.message : "");
  return [prefix, detail].filter(Boolean).join("\n") || "ssh failed.";
}

export async function runRemoteSshDaemonOperation(rawInput: unknown): Promise<void> {
  const input = parseRemoteSshDaemonOperationInput(rawInput);
  const timeoutMs = OPERATION_TIMEOUT_MS[input.operation];
  try {
    await execCommand("ssh", buildRemoteSshDaemonArgs(input), {
      envMode: "internal",
      timeout: timeoutMs,
      maxBuffer: MAX_BUFFER_BYTES,
    });
  } catch (error) {
    throw new Error(describeRemoteSshDaemonFailure(error, timeoutMs), { cause: error });
  }
}
