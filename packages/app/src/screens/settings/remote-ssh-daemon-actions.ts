import {
  RemoteSshDaemonOperation,
  type RemoteSshTransportTarget,
} from "@/desktop/daemon/desktop-daemon";
import type { HostProfile } from "@/types/host-connection";

// Host settings fall back to SSH when the daemon RPC cannot do the job: the host
// is offline, or it runs the upstream `@getpaseo/cli`, whose self-update would
// install upstream again. Fork builds carry `-fork` in their version.
export function isForkDaemonVersion(version: string | null): boolean {
  return version?.includes("-fork") ?? false;
}

/** The host's Remote SSH target, when the desktop app can run commands on it. */
export function resolveRemoteSshTarget(input: {
  host: HostProfile;
  isElectron: boolean;
}): RemoteSshTransportTarget | undefined {
  if (!input.isElectron) return undefined;
  const connection = input.host.connections.find((candidate) => candidate.type === "remoteSsh");
  if (connection?.type !== "remoteSsh") return undefined;
  return {
    transportType: "ssh",
    host: connection.host,
    ...(connection.sshPort !== undefined ? { sshPort: connection.sshPort } : {}),
    ...(connection.daemonPort !== undefined ? { daemonPort: connection.daemonPort } : {}),
  };
}

interface DaemonActionInput {
  hasRemoteSshTarget: boolean;
  isConnected: boolean;
  daemonVersion: string | null;
}

/** `undefined` keeps the daemon RPC update. */
export function resolveRemoteSshUpdateOperation(
  input: DaemonActionInput,
): RemoteSshDaemonOperation | undefined {
  if (!input.hasRemoteSshTarget) return undefined;
  if (!input.isConnected) return RemoteSshDaemonOperation.InstallForkDaemon;
  // A connected host reports its version in server info; until then, keep the RPC path.
  if (input.daemonVersion === null || isForkDaemonVersion(input.daemonVersion)) return undefined;
  return RemoteSshDaemonOperation.InstallForkDaemon;
}

/** `undefined` keeps the daemon RPC restart. */
export function resolveRemoteSshRestartOperation(
  input: Omit<DaemonActionInput, "daemonVersion">,
): RemoteSshDaemonOperation | undefined {
  return input.hasRemoteSshTarget && !input.isConnected
    ? RemoteSshDaemonOperation.StartDaemon
    : undefined;
}
