/* oxlint-disable typescript/consistent-type-definitions -- AGENTS.md requires type aliases. */
import type {
  ConnectionDevice,
  ConnectionHistory,
  ConnectionSession,
} from "@getpaseo/protocol/connection-history";

export enum HistoryGrouping {
  Device = "device",
  Time = "time",
}

export type HistoryView = {
  grouping: HistoryGrouping;
  expandedClientId?: string;
};

export type HistoryEvent = {
  id: string;
  timestamp: string;
  connection?: { device: ConnectionDevice; session: ConnectionSession };
};

export type HistoryDay = { date: Date; events: HistoryEvent[] };

export function deviceIsConnected(device: ConnectionDevice): boolean {
  return device.sessions.some((session) => !session.disconnectedAt);
}

export function deviceLastSeen(device: ConnectionDevice): string {
  return device.sessions.reduce((latest, session) => {
    const seen = session.disconnectedAt ?? session.connectedAt;
    return seen > latest ? seen : latest;
  }, "");
}

export function sortDevices(devices: ConnectionDevice[]): ConnectionDevice[] {
  return [...devices].sort((a, b) => {
    const connected = Number(deviceIsConnected(b)) - Number(deviceIsConnected(a));
    return connected || deviceLastSeen(b).localeCompare(deviceLastSeen(a));
  });
}

export function historyDays(history: ConnectionHistory): HistoryDay[] {
  const events: HistoryEvent[] = history.pairingCodeResets.map((timestamp) => ({
    id: `reset-${timestamp}`,
    timestamp,
  }));
  for (const device of history.devices) {
    for (const session of device.sessions) {
      events.push({
        id: session.id,
        timestamp: session.connectedAt,
        connection: { device, session },
      });
    }
  }
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const days = new Map<string, HistoryDay>();
  for (const event of events) {
    const date = new Date(event.timestamp);
    const dayKey = date.toDateString();
    let day = days.get(dayKey);
    if (!day) {
      day = { date, events: [] };
      days.set(dayKey, day);
    }
    day.events.push(event);
  }
  return [...days.values()];
}
