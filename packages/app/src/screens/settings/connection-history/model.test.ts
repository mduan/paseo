import { expect, test } from "vitest";
import {
  ConnectionTransport,
  DeviceKind,
  isOlderAppVersion,
  deviceDisplayName,
  type ConnectionDevice,
} from "@getpaseo/protocol/connection-history";
import { deviceLastSeen, historyDays, sortDevices } from "./model";

function device(options: {
  id: string;
  connectedAt: string;
  disconnectedAt?: string;
}): ConnectionDevice {
  return {
    clientId: options.id,
    label: options.id,
    kind: DeviceKind.Browser,
    transport: ConnectionTransport.Relay,
    sessions: [
      {
        id: options.id,
        connectedAt: options.connectedAt,
        disconnectedAt: options.disconnectedAt,
        transport: ConnectionTransport.Relay,
      },
    ],
  };
}

test("orders connected devices first and offline devices by their session end", () => {
  const live = device({ id: "live", connectedAt: "2026-10-10T01:00:00.000Z" });
  const recent = device({
    id: "recent",
    connectedAt: "2026-10-17T01:00:00.000Z",
    disconnectedAt: "2026-10-18T01:00:00.000Z",
  });
  const old = device({
    id: "old",
    connectedAt: "2026-10-17T02:00:00.000Z",
    disconnectedAt: "2026-10-17T03:00:00.000Z",
  });
  expect(sortDevices([old, recent, live]).map((entry) => entry.clientId)).toEqual([
    "live",
    "recent",
    "old",
  ]);
  expect(deviceLastSeen(recent)).toBe("2026-10-18T01:00:00.000Z");
});

test("merges resets and sessions chronologically in local calendar days", () => {
  const morning = new Date(2026, 9, 18, 10).toISOString();
  const reset = new Date(2026, 9, 18, 9).toISOString();
  const yesterday = new Date(2026, 9, 17, 23).toISOString();
  const days = historyDays({
    devices: [
      device({ id: "first", connectedAt: yesterday }),
      device({ id: "second", connectedAt: morning }),
    ],
    pairingCodeResets: [reset],
  });
  expect(days.map((day) => day.events.map((event) => event.id))).toEqual([
    ["second", `reset-${reset}`],
    ["first"],
  ]);
  expect(days[0].events[0].connection?.device.clientId).toBe("second");
});

test("only labels valid versions older than the host as old", () => {
  expect(isOlderAppVersion({ appVersion: "0.10.3", hostVersion: "0.11.0-fork.23" })).toBe(true);
  expect(isOlderAppVersion({ appVersion: "0.11.4", hostVersion: "0.11.0-fork.23" })).toBe(false);
  expect(isOlderAppVersion({ appVersion: "0.11.0-fork.23", hostVersion: "0.11.0-fork.23" })).toBe(
    false,
  );
  expect(isOlderAppVersion({ appVersion: "development", hostVersion: "0.11.0-fork.23" })).toBe(
    false,
  );
});

test("uses the custom device name in preference to the reported label", () => {
  const phone = device({ id: "Android", connectedAt: "2026-10-18T01:00:00.000Z" });
  expect(deviceDisplayName(phone)).toBe("Android");
  expect(deviceDisplayName({ ...phone, customLabel: "Personal phone" })).toBe("Personal phone");
});
