import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test } from "vitest";
import { ConnectionTransport, DeviceKind } from "@getpaseo/protocol/connection-history";
import type { WSHelloMessage } from "@getpaseo/protocol/messages";
import { ConnectionHistoryStore } from "./store.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function historyFixture() {
  const paseoHome = mkdtempSync(join(tmpdir(), "paseo-connection-history-"));
  directories.push(paseoHome);
  let timestamp = "2026-10-18T10:00:00.000Z";
  const options = { paseoHome, logger: pino({ level: "silent" }), now: () => new Date(timestamp) };
  return {
    paseoHome,
    store: new ConnectionHistoryStore(options),
    reopen: () => new ConnectionHistoryStore(options),
    advance: (next: string) => {
      timestamp = next;
    },
    read: () => JSON.parse(readFileSync(join(paseoHome, "connection-history.json"), "utf8")),
  };
}

const hello: WSHelloMessage = {
  type: "hello",
  clientId: "cid_0f674321",
  clientType: "mobile",
  protocolVersion: 1,
  deviceLabel: "iPhone",
  deviceKind: DeviceKind.Mobile,
  appVersion: "0.11.0",
};

test("persists logical sessions once, keeps per-session versions, and ends only on teardown", () => {
  const fixture = historyFixture();
  fixture.store.connect({ hello, sessionId: "first", transport: ConnectionTransport.Relay });
  fixture.advance("2026-10-18T10:01:00.000Z");
  fixture.store.connect({
    hello: { ...hello, appVersion: "0.11.1" },
    sessionId: "first",
    transport: ConnectionTransport.Relay,
  });
  expect(fixture.store.getHistory().devices[0]).toEqual({
    clientId: hello.clientId,
    label: "iPhone",
    kind: DeviceKind.Mobile,
    transport: ConnectionTransport.Relay,
    appVersion: "0.11.1",
    sessions: [
      {
        id: "first",
        connectedAt: "2026-10-18T10:00:00.000Z",
        transport: ConnectionTransport.Relay,
        appVersion: "0.11.0",
      },
    ],
  });
  fixture.store.disconnect("first");
  fixture.advance("2026-10-18T10:02:00.000Z");
  fixture.store.connect({
    hello: { ...hello, appVersion: "0.11.1" },
    sessionId: "second",
    transport: ConnectionTransport.SshTunnel,
  });
  const sessions = fixture.store.getHistory().devices[0].sessions;
  expect(sessions.map((session) => session.id)).toEqual(["second", "first"]);
  expect(sessions[1].disconnectedAt).toBe("2026-10-18T10:01:00.000Z");
  expect(sessions[0].transport).toBe(ConnectionTransport.SshTunnel);
  expect(fixture.read()).toEqual({
    devices: [{ ...fixture.store.getHistory().devices[0], sessions: sessions.toReversed() }],
    pairingCodeResets: [],
  });
});

test("recovers an unclosed session after a crash and retains pairing code resets", () => {
  const fixture = historyFixture();
  fixture.store.connect({
    hello,
    sessionId: "crashed",
    transport: ConnectionTransport.DirectLocal,
  });
  fixture.store.recordPairingCodeReset("2026-10-18T10:00:30.000Z");
  fixture.advance("2026-10-18T10:01:00.000Z");
  const recovered = fixture.reopen().getHistory();
  expect(recovered.devices[0].sessions[0].disconnectedAt).toBe("2026-10-18T10:01:00.000Z");
  expect(recovered.pairingCodeResets).toEqual(["2026-10-18T10:00:30.000Z"]);
});

test("excludes non-app clients and names legacy app installs by their connection", () => {
  const { store } = historyFixture();
  for (const clientType of ["cli", "mcp", "hub"] as const) {
    store.connect({
      hello: { ...hello, clientType },
      sessionId: clientType,
      transport: ConnectionTransport.Relay,
    });
  }
  expect(store.getHistory()).toEqual({ devices: [], pairingCodeResets: [] });
  store.connect({
    hello: { ...hello, deviceLabel: undefined, deviceKind: undefined },
    sessionId: "legacy",
    transport: ConnectionTransport.Relay,
  });
  expect(store.getHistory().devices[0].label).toBe("Relay device · 0f67");
});

test("prunes closed sessions and reset events after 30 days, including while idle", () => {
  const fixture = historyFixture();
  fixture.store.connect({ hello, sessionId: "expired", transport: ConnectionTransport.Relay });
  fixture.store.disconnect("expired");
  fixture.store.recordPairingCodeReset("2026-10-18T10:00:00.000Z");
  fixture.advance("2026-11-18T10:00:00.000Z");
  expect(fixture.store.getHistory()).toEqual({ devices: [], pairingCodeResets: [] });
  expect(fixture.read()).toEqual({ devices: [], pairingCodeResets: [] });
});

test("custom names survive reconnects, pairing code resets, and reopening the store", () => {
  const fixture = historyFixture();
  fixture.store.connect({ hello, sessionId: "first", transport: ConnectionTransport.Relay });
  fixture.store.connect({
    hello: { ...hello, clientId: "cid_second", deviceLabel: "iPhone" },
    sessionId: "other-installation",
    transport: ConnectionTransport.Relay,
  });
  const renamed = fixture.store.renameDevice({ clientId: hello.clientId, label: "  My phone  " });
  expect(renamed.devices[0].customLabel).toBe("My phone");
  expect(renamed.devices[1]).toMatchObject({ clientId: "cid_second", label: "iPhone" });
  expect(renamed.devices[1].customLabel).toBeUndefined();
  // Returned snapshots must not allow callers to change the saved name.
  renamed.devices[0].customLabel = "Changed snapshot";
  fixture.store.connect({
    hello: { ...hello, deviceLabel: "Android" },
    sessionId: "second",
    transport: ConnectionTransport.Relay,
  });
  fixture.store.recordPairingCodeReset("2026-10-18T10:00:30.000Z");
  expect(fixture.reopen().getHistory().devices[0]).toMatchObject({
    label: "Android",
    customLabel: "My phone",
  });
  expect(fixture.read().devices[0].customLabel).toBe("My phone");
});

test("rejects invalid names and unknown devices without changing history", () => {
  const fixture = historyFixture();
  fixture.store.connect({ hello, sessionId: "first", transport: ConnectionTransport.Relay });
  const before = fixture.read();
  expect(() => fixture.store.renameDevice({ clientId: hello.clientId, label: "   " })).toThrow(
    "Enter a device name",
  );
  expect(() =>
    fixture.store.renameDevice({ clientId: hello.clientId, label: "x".repeat(81) }),
  ).toThrow("80 characters");
  expect(() => fixture.store.renameDevice({ clientId: "unknown", label: "Phone" })).toThrow(
    "Device not found",
  );
  expect(fixture.store.getHistory()).toEqual(before);
  expect(fixture.read()).toEqual(before);
  expect(
    fixture.store.renameDevice({ clientId: hello.clientId, label: "x".repeat(80) }).devices[0]
      .customLabel,
  ).toHaveLength(80);
});

test("a failed write preserves the accepted name in memory and permits retry", () => {
  const fixture = historyFixture();
  fixture.store.connect({ hello, sessionId: "first", transport: ConnectionTransport.Relay });
  fixture.store.renameDevice({ clientId: hello.clientId, label: "Saved phone" });
  const file = join(fixture.paseoHome, "connection-history.json");
  rmSync(file);
  mkdirSync(file);
  expect(() =>
    fixture.store.renameDevice({ clientId: hello.clientId, label: "Unsaved phone" }),
  ).toThrow();
  expect(fixture.store.getHistory().devices[0].customLabel).toBe("Saved phone");
  rmSync(file, { recursive: true });
  fixture.store.renameDevice({ clientId: hello.clientId, label: "Retried phone" });
  expect(fixture.reopen().getHistory().devices[0].customLabel).toBe("Retried phone");
});
