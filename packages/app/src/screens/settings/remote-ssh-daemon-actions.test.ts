import { describe, expect, it } from "vitest";
import { RemoteSshDaemonOperation } from "@/desktop/daemon/desktop-daemon";
import {
  createRemoteSshHostConnection,
  type HostConnection,
  type HostProfile,
  upsertHostConnectionInProfiles,
} from "@/types/host-connection";
import {
  isForkDaemonVersion,
  resolveRemoteSshRestartOperation,
  resolveRemoteSshTarget,
  resolveRemoteSshUpdateOperation,
} from "./remote-ssh-daemon-actions";

function hostWith(connection: HostConnection): HostProfile {
  const [host] = upsertHostConnectionInProfiles({
    profiles: [],
    serverId: "srv_devbox",
    connection,
    now: "2026-10-04T00:00:00.000Z",
  });
  return host!;
}

const sshHost = hostWith(
  createRemoteSshHostConnection({ host: "mack@devbox", sshPort: 2222, daemonPort: 7777 }),
);
const tcpHost = hostWith({ id: "tcp:devbox:6767", type: "directTcp", endpoint: "devbox:6767" });

describe("resolveRemoteSshTarget", () => {
  it("uses the host's Remote SSH connection in the desktop app", () => {
    expect(resolveRemoteSshTarget({ host: sshHost, isElectron: true })).toEqual({
      transportType: "ssh",
      host: "mack@devbox",
      sshPort: 2222,
      daemonPort: 7777,
    });
  });

  it("has no target outside the desktop app or without a Remote SSH connection", () => {
    expect(resolveRemoteSshTarget({ host: sshHost, isElectron: false })).toBeUndefined();
    expect(resolveRemoteSshTarget({ host: tcpHost, isElectron: true })).toBeUndefined();
  });
});

describe("daemon card actions", () => {
  it.each([
    {
      state: "fork daemon online",
      connectionStatus: "online" as const,
      daemonVersion: "0.11.0-fork.1",
      update: undefined,
      restart: undefined,
    },
    {
      state: "upstream daemon online",
      connectionStatus: "online" as const,
      daemonVersion: "0.10.3",
      update: RemoteSshDaemonOperation.InstallForkDaemon,
      restart: undefined,
    },
    {
      state: "online before server info arrives",
      connectionStatus: "online" as const,
      daemonVersion: null,
      update: undefined,
      restart: undefined,
    },
    {
      state: "offline or no daemon",
      connectionStatus: "offline" as const,
      daemonVersion: null,
      update: RemoteSshDaemonOperation.InstallForkDaemon,
      restart: RemoteSshDaemonOperation.StartDaemon,
    },
    {
      state: "connection error",
      connectionStatus: "error" as const,
      daemonVersion: null,
      update: RemoteSshDaemonOperation.InstallForkDaemon,
      restart: RemoteSshDaemonOperation.StartDaemon,
    },
    {
      state: "still connecting",
      connectionStatus: "connecting" as const,
      daemonVersion: null,
      update: undefined,
      restart: undefined,
    },
    {
      state: "idle",
      connectionStatus: "idle" as const,
      daemonVersion: null,
      update: undefined,
      restart: undefined,
    },
  ])("$state over Remote SSH", ({ connectionStatus, daemonVersion, update, restart }) => {
    expect(
      resolveRemoteSshUpdateOperation({
        hasRemoteSshTarget: true,
        connectionStatus,
        daemonVersion,
      }),
    ).toBe(update);
    expect(resolveRemoteSshRestartOperation({ hasRemoteSshTarget: true, connectionStatus })).toBe(
      restart,
    );
  });

  it("keeps the daemon RPCs without a Remote SSH target", () => {
    expect(
      resolveRemoteSshUpdateOperation({
        hasRemoteSshTarget: false,
        connectionStatus: "offline",
        daemonVersion: "0.10.3",
      }),
    ).toBeUndefined();
    expect(
      resolveRemoteSshRestartOperation({ hasRemoteSshTarget: false, connectionStatus: "offline" }),
    ).toBeUndefined();
  });

  it("detects fork builds by version", () => {
    expect(isForkDaemonVersion("0.11.0-fork.1")).toBe(true);
    expect(isForkDaemonVersion("0.10.3")).toBe(false);
    expect(isForkDaemonVersion(null)).toBe(false);
  });
});
