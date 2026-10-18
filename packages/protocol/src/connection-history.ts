import { z } from "zod";
import valid from "semver/functions/valid.js";
import lt from "semver/functions/lt.js";

export enum ConnectionTransport {
  Relay = "relay",
  DirectLocal = "direct-local",
  DirectNetwork = "direct-network",
  SshTunnel = "ssh-tunnel",
}

export enum DeviceKind {
  Desktop = "desktop",
  Mobile = "mobile",
  Browser = "browser",
}

export const ConnectionSessionSchema = z.object({
  id: z.string(),
  connectedAt: z.string().datetime(),
  disconnectedAt: z.string().datetime().optional(),
  transport: z.enum(ConnectionTransport),
  appVersion: z.string().optional(),
});

export const ConnectionDeviceSchema = z.object({
  clientId: z.string(),
  label: z.string(),
  kind: z.enum(DeviceKind),
  transport: z.enum(ConnectionTransport),
  appVersion: z.string().optional(),
  sessions: z.array(ConnectionSessionSchema),
});

export const ConnectionHistorySchema = z.object({
  devices: z.array(ConnectionDeviceSchema),
  pairingCodeResets: z.array(z.string().datetime()),
});

export type ConnectionHistory = z.infer<typeof ConnectionHistorySchema>;
export type ConnectionDevice = z.infer<typeof ConnectionDeviceSchema>;
export type ConnectionSession = z.infer<typeof ConnectionSessionSchema>;

export function isOlderAppVersion(options: { appVersion?: string; hostVersion?: string }): boolean {
  const app = options.appVersion && valid(options.appVersion);
  const host = options.hostVersion && valid(options.hostVersion);
  return Boolean(app && host && lt(app, host));
}
