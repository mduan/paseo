import { describe, expect, it } from "vitest";
import {
  buildRemoteSshDaemonArgs,
  buildRemoteSshDaemonCommand,
  describeRemoteSshDaemonFailure,
  parseRemoteSshDaemonOperationInput,
  RemoteSshDaemonOperation,
} from "./remote-ssh-daemon";

describe("remote SSH daemon operations", () => {
  it("replaces the upstream CLI with the fork package and restarts the whole daemon", () => {
    expect(buildRemoteSshDaemonCommand(RemoteSshDaemonOperation.InstallForkDaemon)).toBe(
      "npm uninstall -g @getpaseo/cli; npm install -g @mduan/paseo-cli@latest && (paseo daemon stop; paseo daemon start)",
    );
  });

  it("starts the installed daemon", () => {
    expect(buildRemoteSshDaemonCommand(RemoteSshDaemonOperation.StartDaemon)).toBe(
      "paseo daemon start",
    );
  });

  it("runs the command over the host's SSH target in a login shell", () => {
    expect(
      buildRemoteSshDaemonArgs({
        target: { transportType: "ssh", host: "mack@devbox", sshPort: 2222, daemonPort: 7777 },
        operation: RemoteSshDaemonOperation.StartDaemon,
      }),
    ).toEqual([
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "ClearAllForwardings=yes",
      "-p",
      "2222",
      "mack@devbox",
      "bash -lc 'paseo daemon start'",
    ]);
  });

  it("accepts only known operations on Remote SSH targets", () => {
    expect(
      parseRemoteSshDaemonOperationInput({
        target: { transportType: "ssh", host: "devbox" },
        operation: "start_daemon",
      }),
    ).toEqual({
      target: { transportType: "ssh", host: "devbox" },
      operation: RemoteSshDaemonOperation.StartDaemon,
    });
    expect(() =>
      parseRemoteSshDaemonOperationInput({
        target: { transportType: "ssh", host: "devbox" },
        operation: "rm -rf /",
      }),
    ).toThrow("Unsupported Remote SSH daemon operation.");
    expect(() =>
      parseRemoteSshDaemonOperationInput({
        target: { transportType: "socket", transportPath: "/tmp/paseo.sock" },
        operation: "start_daemon",
      }),
    ).toThrow("Remote SSH daemon operations need a Remote SSH host.");
  });

  it("surfaces stderr, then stdout, and reports timeouts", () => {
    expect(
      describeRemoteSshDaemonFailure({ stderr: "npm ERR! EACCES\n", stdout: "partial" }, 60_000),
    ).toBe("npm ERR! EACCES");
    expect(describeRemoteSshDaemonFailure({ stderr: "", stdout: "paseo: not found" }, 60_000)).toBe(
      "paseo: not found",
    );
    expect(describeRemoteSshDaemonFailure({ killed: true, stderr: "" }, 600_000)).toBe(
      "Timed out after 10 minutes.",
    );
  });
});
