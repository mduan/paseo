import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  ConnectionHistorySchema,
  ConnectionTransport,
  DeviceKind,
} from "@getpaseo/protocol/connection-history";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

test("app history survives socket reconnects, excludes CLI clients, and closes on daemon shutdown", async () => {
  const daemon = await createTestPaseoDaemon({ mcpEnabled: false });
  const base = { url: `ws://127.0.0.1:${daemon.port}/ws`, reconnect: { enabled: false } };
  const cli = new DaemonClient({ ...base, clientId: "cli-history-reader" });
  const appOptions = {
    ...base,
    clientId: "cid_abcd1234",
    clientType: "mobile" as const,
    deviceLabel: "Paseo Desktop · Test Mac",
    deviceKind: DeviceKind.Desktop,
    connectionTransport: ConnectionTransport.SshTunnel as const,
    appVersion: "0.11.0-fork.24",
  };
  const app = new DaemonClient(appOptions);
  const resumed = new DaemonClient(appOptions);
  try {
    await cli.connect();
    expect(cli.getLastServerInfoMessage()?.features?.connectionHistory).toBe(true);
    expect((await cli.getConnectionHistory()).devices).toEqual([]);
    await app.connect();
    const initial = await cli.getConnectionHistory();
    expect(initial.devices).toHaveLength(1);
    expect(initial.devices[0]).toMatchObject({
      clientId: "cid_abcd1234",
      label: "Paseo Desktop · Test Mac",
      kind: DeviceKind.Desktop,
      transport: ConnectionTransport.SshTunnel,
    });
    await app.close();
    await resumed.connect();
    expect((await cli.getConnectionHistory()).devices[0].sessions).toEqual(
      initial.devices[0].sessions,
    );
    await cli.resetDaemonPairingOffer();
    expect((await cli.getConnectionHistory()).pairingCodeResets).toHaveLength(1);
    await daemon.daemon.stop();
    const persisted = ConnectionHistorySchema.parse(
      JSON.parse(readFileSync(join(daemon.paseoHome, "connection-history.json"), "utf8")),
    );
    expect(persisted.devices[0].sessions).toHaveLength(1);
    expect(persisted.devices[0].sessions[0].disconnectedAt).toEqual(expect.any(String));
  } finally {
    await app.close();
    await resumed.close();
    await cli.close();
    await daemon.close();
  }
}, 30_000);
