import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { once } from "node:events";
import { WebSocketServer, WebSocket } from "ws";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  ConnectionHistorySchema,
  ConnectionTransport,
  DeviceKind,
} from "@getpaseo/protocol/connection-history";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { loadOrCreateDaemonKeyPair } from "../daemon-keypair.js";

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
    expect(cli.getLastServerInfoMessage()?.features?.connectionHistoryRename).toBe(true);
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
    const renamed = await cli.renameConnectionDevice({
      clientId: appOptions.clientId,
      label: "  My Mac  ",
    });
    expect(renamed.devices[0]).toMatchObject({
      label: appOptions.deviceLabel,
      customLabel: "My Mac",
    });
    await expect(
      cli.renameConnectionDevice({ clientId: "missing", label: "Phone" }),
    ).rejects.toThrow("Device not found");
    await expect(
      cli.renameConnectionDevice({ clientId: appOptions.clientId, label: "   " }),
    ).rejects.toThrow("Enter a device name");
    await expect(
      cli.renameConnectionDevice({ clientId: appOptions.clientId, label: "x".repeat(81) }),
    ).rejects.toThrow("80 characters");
    await app.close();
    await resumed.connect();
    expect((await cli.getConnectionHistory()).devices[0].sessions).toEqual(
      initial.devices[0].sessions,
    );
    expect((await cli.getConnectionHistory()).devices[0].customLabel).toBe("My Mac");
    await cli.resetDaemonPairingOffer();
    expect((await cli.getConnectionHistory()).pairingCodeResets).toHaveLength(1);
    await daemon.daemon.stop();
    const persisted = ConnectionHistorySchema.parse(
      JSON.parse(readFileSync(join(daemon.paseoHome, "connection-history.json"), "utf8")),
    );
    expect(persisted.devices[0].customLabel).toBe("My Mac");
    expect(persisted.devices[0].sessions).toHaveLength(1);
    expect(persisted.devices[0].sessions[0].disconnectedAt).toEqual(expect.any(String));
  } finally {
    await app.close();
    await resumed.close();
    await cli.close();
    await daemon.close();
  }
}, 30_000);

test("revokes old relay connections even when recording the reset fails", async () => {
  const relay = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const connections: WebSocket[] = [];
  relay.on("connection", (socket, request) => {
    connections.push(socket);
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.searchParams.has("connectionId")) {
      socket.send(JSON.stringify({ type: "sync", connectionIds: ["history-reset-test"] }));
    }
  });
  await once(relay, "listening");
  const address = relay.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP relay address");
  let daemon: Awaited<ReturnType<typeof createTestPaseoDaemon>> | undefined;
  let client: DaemonClient | undefined;
  try {
    daemon = await createTestPaseoDaemon({
      mcpEnabled: false,
      relayEnabled: true,
      relayEndpoint: `127.0.0.1:${address.port}`,
      relayUseTls: false,
    });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      clientId: "cli-reset-history-failure",
      reconnect: { enabled: false },
    });
    await client.connect();
    await expect.poll(() => connections.length).toBe(2);
    const oldConnections = [...connections];
    const oldKey = await loadOrCreateDaemonKeyPair(daemon.paseoHome);
    mkdirSync(join(daemon.paseoHome, "connection-history.json"));

    await expect(client.resetDaemonPairingOffer()).rejects.toThrow();

    const newKey = await loadOrCreateDaemonKeyPair(daemon.paseoHome);
    expect(newKey.publicKeyB64).not.toBe(oldKey.publicKeyB64);
    await expect
      .poll(() => oldConnections.map((socket) => socket.readyState))
      .toEqual([WebSocket.CLOSED, WebSocket.CLOSED]);
    await expect.poll(() => connections.length).toBe(4);
  } finally {
    if (daemon)
      rmSync(join(daemon.paseoHome, "connection-history.json"), { recursive: true, force: true });
    await client?.close();
    await daemon?.close();
    for (const socket of relay.clients) socket.terminate();
    const relayClosed = once(relay, "close");
    relay.close();
    await relayClosed;
  }
}, 30_000);
