import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type pino from "pino";
import {
  ConnectionHistorySchema,
  DEVICE_NAME_MAX_LENGTH,
  ConnectionTransport,
  DeviceKind,
  type ConnectionHistory,
} from "@getpaseo/protocol/connection-history";
import type { WSHelloMessage } from "@getpaseo/protocol/messages";
import { writePrivateFileAtomicSync } from "../private-files.js";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export class ConnectionHistoryStore {
  private readonly filePath: string;
  private readonly now: () => Date;
  private readonly logger: pino.Logger;
  private history: ConnectionHistory = { devices: [], pairingCodeResets: [] };

  constructor(options: { paseoHome: string; logger: pino.Logger; now?: () => Date }) {
    this.filePath = join(options.paseoHome, "connection-history.json");
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
    if (!existsSync(this.filePath)) return;
    this.history = ConnectionHistorySchema.parse(JSON.parse(readFileSync(this.filePath, "utf8")));
    const restartedAt = this.now().toISOString();
    for (const device of this.history.devices) {
      for (const session of device.sessions) {
        if (!session.disconnectedAt) session.disconnectedAt = restartedAt;
      }
    }
    this.save();
  }

  connect(options: {
    hello: WSHelloMessage;
    sessionId: string;
    transport: ConnectionTransport;
  }): void {
    const { hello, sessionId, transport } = options;
    if (hello.clientType !== "mobile" && hello.clientType !== "browser") return;
    let device = this.history.devices.find((entry) => entry.clientId === hello.clientId);
    const label = hello.deviceLabel?.trim();
    if (!device) {
      const prefix = {
        [ConnectionTransport.Relay]: "Relay",
        [ConnectionTransport.DirectLocal]: "Local",
        [ConnectionTransport.DirectNetwork]: "Network",
        [ConnectionTransport.SshTunnel]: "Local",
      }[transport];
      const suffix = hello.clientId
        .replace(/^cid_/, "")
        .replace(/[^a-f0-9]/gi, "")
        .slice(0, 4);
      device = {
        clientId: hello.clientId,
        label: label || `${prefix} device · ${suffix}`,
        kind: hello.deviceKind ?? DeviceKind.Browser,
        transport,
        appVersion: hello.appVersion,
        sessions: [],
      };
      this.history.devices.push(device);
    }
    if (label) device.label = label;
    if (hello.deviceKind) device.kind = hello.deviceKind;
    device.transport = transport;
    if (hello.appVersion) device.appVersion = hello.appVersion;
    if (!device.sessions.some((session) => session.id === sessionId)) {
      device.sessions.push({
        id: sessionId,
        connectedAt: this.now().toISOString(),
        transport,
        appVersion: hello.appVersion,
      });
    }
    this.saveSessionHistory();
  }

  renameDevice(options: { clientId: string; label: string }): ConnectionHistory {
    const label = options.label.trim();
    if (!label) throw new Error("Enter a device name");
    if (label.length > DEVICE_NAME_MAX_LENGTH) {
      throw new Error(`Device name must be ${DEVICE_NAME_MAX_LENGTH} characters or fewer`);
    }
    const next = this.getHistory();
    const device = next.devices.find((entry) => entry.clientId === options.clientId);
    if (!device) throw new Error("Device not found");
    device.customLabel = label;
    writePrivateFileAtomicSync(this.filePath, `${JSON.stringify(next)}\n`);
    this.history = next;
    return structuredClone(next);
  }

  disconnect(sessionId: string): void {
    for (const device of this.history.devices) {
      const session = device.sessions.find((entry) => entry.id === sessionId);
      if (session && !session.disconnectedAt) {
        session.disconnectedAt = this.now().toISOString();
        this.saveSessionHistory();
        return;
      }
    }
  }

  recordPairingCodeReset(timestamp: string): void {
    this.history.pairingCodeResets.push(timestamp);
    this.save();
  }

  getHistory(): ConnectionHistory {
    if (this.prune()) this.save();
    const snapshot = structuredClone(this.history);
    for (const device of snapshot.devices) {
      device.sessions.sort((a, b) => b.connectedAt.localeCompare(a.connectedAt));
    }
    return snapshot;
  }

  private prune(): boolean {
    const cutoff = this.now().getTime() - RETENTION_MS;
    let changed = false;
    for (const device of this.history.devices) {
      const retained = device.sessions.filter(
        (session) => !session.disconnectedAt || Date.parse(session.disconnectedAt) >= cutoff,
      );
      if (retained.length !== device.sessions.length) changed = true;
      device.sessions = retained;
    }
    const devices = this.history.devices.filter((device) => device.sessions.length > 0);
    const resets = this.history.pairingCodeResets.filter(
      (timestamp) => Date.parse(timestamp) >= cutoff,
    );
    changed ||=
      devices.length !== this.history.devices.length ||
      resets.length !== this.history.pairingCodeResets.length;
    this.history.devices = devices;
    this.history.pairingCodeResets = resets;
    return changed;
  }

  private saveSessionHistory(): void {
    try {
      this.save();
    } catch (error) {
      this.logger.error({ err: error }, "Failed to save connection session history");
    }
  }

  private save(): void {
    this.prune();
    writePrivateFileAtomicSync(this.filePath, `${JSON.stringify(this.history)}\n`);
  }
}
