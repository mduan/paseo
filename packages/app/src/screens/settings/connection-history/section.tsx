import { useCallback, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Theme } from "@/styles/theme";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { Text, View } from "react-native";
import { Globe, Laptop, RotateCw, Smartphone } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  ConnectionTransport,
  DeviceKind,
  isOlderAppVersion,
  type ConnectionDevice,
  type ConnectionSession,
} from "@getpaseo/protocol/connection-history";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { SettingsCollapsibleRow } from "@/components/settings/collapsible-row";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
import { formatDuration, formatMessageTimestamp } from "@/utils/time";
import {
  deviceIsConnected,
  deviceLastSeen,
  historyDays,
  HistoryGrouping,
  sortDevices,
  type HistoryView,
} from "./model";

const ThemedGlobe = withUnistyles(Globe);
const ThemedLaptop = withUnistyles(Laptop);
const ThemedSmartphone = withUnistyles(Smartphone);
const ThemedReset = withUnistyles(RotateCw);
const warningIconMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });

export function ConnectionHistorySection({ serverId }: { serverId: string }) {
  const connected = useHostRuntimeIsConnected(serverId);
  // COMPAT(connectionHistory): added in v0.11.0-fork.24, remove gate after 2027-04-18.
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.connectionHistory === true,
  );
  if (!supported) return null;
  return <ConnectionHistoryContent key={serverId} serverId={serverId} connected={connected} />;
}

function ConnectionHistoryContent({
  serverId,
  connected,
}: {
  serverId: string;
  connected: boolean;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const active = useRetainedPanelActive();
  const [view, setView] = useState<HistoryView>({ grouping: HistoryGrouping.Device });
  const history = useFetchQuery({
    queryKey: ["connection-history", serverId],
    queryFn: () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return client.getConnectionHistory();
    },
    dataShape: "value",
    staleTimeMs: 0,
    enabled: connected && active,
    refetchInterval: 5000,
  });
  const hostVersion = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.version ?? undefined,
  );
  const options = useMemo(
    () => [
      {
        value: HistoryGrouping.Device,
        label: t("pairing.history.device"),
        testID: "history-group-device",
      },
      {
        value: HistoryGrouping.Time,
        label: t("pairing.history.time"),
        testID: "history-group-time",
      },
    ],
    [t],
  );
  const selectGrouping = useCallback(
    (grouping: HistoryGrouping) => setView((previous) => ({ ...previous, grouping })),
    [],
  );
  const showDevice = useCallback(
    (clientId: string) => setView({ grouping: HistoryGrouping.Device, expandedClientId: clientId }),
    [],
  );
  const refetch = history.refetch;
  const retry = useCallback(() => void refetch(), [refetch]);
  const switchControl = useMemo(
    () => (
      <SegmentedControl
        size="sm"
        options={options}
        value={view.grouping}
        onValueChange={selectGrouping}
      />
    ),
    [options, view.grouping, selectGrouping],
  );
  const hasResetsInTimeView =
    view.grouping === HistoryGrouping.Time && Boolean(history.data?.pairingCodeResets.length);
  const isEmpty = history.data && !history.data.devices.length && !hasResetsInTimeView;

  return (
    <SettingsSection
      title={t("pairing.history.title")}
      testID="connection-history"
      trailing={switchControl}
    >
      {!connected ? (
        <Alert size="sm" description={t("workspace.terminal.hostDisconnected")} />
      ) : null}
      {history.error && connected ? (
        <Alert size="sm" variant="error" description={history.error.message}>
          <Button variant="outline" size="sm" loading={history.isFetching} onPress={retry}>
            {t("common.actions.retry")}
          </Button>
        </Alert>
      ) : null}
      {history.isPending && connected ? (
        <View style={settingsStyles.card}>
          <Text style={styles.empty}>{t("pairing.history.loading")}</Text>
        </View>
      ) : null}
      {isEmpty ? (
        <View style={settingsStyles.card}>
          <Text style={styles.empty}>{t("pairing.history.empty")}</Text>
        </View>
      ) : null}
      {history.data &&
      history.data.devices.length > 0 &&
      view.grouping === HistoryGrouping.Device ? (
        <View style={settingsStyles.card}>
          {sortDevices(history.data.devices).map((device, index) => (
            <View key={device.clientId} style={index > 0 && settingsStyles.rowBorder}>
              <DeviceRow
                device={device}
                hostVersion={hostVersion}
                hostConnected={connected}
                expanded={view.expandedClientId === device.clientId}
                setView={setView}
              />
            </View>
          ))}
        </View>
      ) : null}
      {history.data && view.grouping === HistoryGrouping.Time
        ? historyDays(history.data).map((day) => (
            <SettingsSection key={day.date.toDateString()} title={dayLabel(day.date, t)} flush>
              <View style={settingsStyles.card}>
                {day.events.map((event, index) => (
                  <View key={event.id} style={index > 0 && settingsStyles.rowBorder}>
                    {event.connection ? (
                      <SessionRow
                        session={event.connection.session}
                        device={event.connection.device}
                        onDevicePress={showDevice}
                        hostConnected={connected}
                      />
                    ) : (
                      <View style={[settingsStyles.row, styles.reset]}>
                        <Text style={[styles.meta, styles.warning]}>{clock(event.timestamp)}</Text>
                        <ThemedReset size={ICON_SIZE.sm} uniProps={warningIconMapping} />
                        <Text style={[styles.resetLabel, styles.warning]}>
                          {t("pairing.history.reset")}
                        </Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </SettingsSection>
          ))
        : null}
    </SettingsSection>
  );
}

function DeviceRow({
  device,
  hostVersion,
  hostConnected,
  expanded,
  setView,
}: {
  device: ConnectionDevice;
  hostVersion?: string;
  hostConnected: boolean;
  expanded: boolean;
  setView: Dispatch<SetStateAction<HistoryView>>;
}) {
  const toggle = useCallback(
    (next: boolean) =>
      setView({
        grouping: HistoryGrouping.Device,
        expandedClientId: next ? device.clientId : undefined,
      }),
    [setView, device.clientId],
  );
  const summary = useMemo(
    () => <DeviceSummary device={device} hostVersion={hostVersion} hostConnected={hostConnected} />,
    [device, hostVersion, hostConnected],
  );
  return (
    <SettingsCollapsibleRow
      label={device.label}
      testID={`history-device-${device.clientId}`}
      expanded={expanded}
      onExpandedChange={toggle}
      summary={summary}
    >
      {device.sessions.map((session) => (
        <SessionRow key={session.id} session={session} hostConnected={hostConnected} />
      ))}
    </SettingsCollapsibleRow>
  );
}

function DeviceSummary({
  device,
  hostVersion,
  hostConnected,
}: {
  device: ConnectionDevice;
  hostVersion?: string;
  hostConnected: boolean;
}) {
  const { t } = useTranslation();
  const connected = hostConnected && deviceIsConnected(device);
  const Icon = {
    [DeviceKind.Desktop]: ThemedLaptop,
    [DeviceKind.Mobile]: ThemedSmartphone,
    [DeviceKind.Browser]: ThemedGlobe,
  }[device.kind];
  const status = connected
    ? t("pairing.history.connectedNow")
    : t("pairing.history.lastSeen", {
        time: formatMessageTimestamp(new Date(deviceLastSeen(device))),
      });
  return (
    <View style={styles.device}>
      <View style={styles.icon}>
        <Icon size={ICON_SIZE.md} uniProps={mutedIconColorMapping} />
      </View>
      <View style={styles.deviceBody}>
        <View style={styles.titleRow}>
          <Text style={settingsStyles.rowTitle}>{device.label}</Text>
          {isOlderAppVersion({ appVersion: device.appVersion, hostVersion }) ? (
            <StatusBadge variant="warning" size="xs" label={t("pairing.history.oldVersion")} />
          ) : null}
        </View>
        <Text style={settingsStyles.rowHint}>
          {transportLabel(device.transport, t)} · {versionLabel(device.appVersion, t)} ·{" "}
          {t("pairing.history.connections", { count: device.sessions.length })}
        </Text>
        <View style={styles.compactStatus}>
          <ConnectionStatus label={status} connected={connected} />
        </View>
      </View>
      <View style={styles.wideStatus}>
        <ConnectionStatus label={status} connected={connected} />
      </View>
    </View>
  );
}

function ConnectionStatus({ label, connected }: { label: string; connected: boolean }) {
  return (
    <View style={styles.status}>
      <View style={[styles.dot, connected && styles.dotConnected]} />
      <Text style={styles.meta}>{label}</Text>
    </View>
  );
}

function SessionRow({
  session,
  device,
  onDevicePress,
  hostConnected,
}: {
  session: ConnectionSession;
  device?: ConnectionDevice;
  onDevicePress?: (clientId: string) => void;
  hostConnected: boolean;
}) {
  const { t } = useTranslation();
  const selectDevice = useCallback(() => {
    if (device) onDevicePress?.(device.clientId);
  }, [device, onDevicePress]);
  const connected = hostConnected && !session.disconnectedAt;
  let duration = t("pairing.history.disconnected");
  if (session.disconnectedAt)
    duration = formatDuration(Date.parse(session.disconnectedAt) - Date.parse(session.connectedAt));
  if (connected) duration = t("pairing.history.connected");
  const timestamp = device
    ? clock(session.connectedAt)
    : formatMessageTimestamp(new Date(session.connectedAt));
  return (
    <View style={[settingsStyles.row, styles.session]}>
      <Text style={styles.timestamp}>{timestamp}</Text>
      {device ? <View style={[styles.dot, connected && styles.dotConnected]} /> : null}
      <View style={styles.sessionBody}>
        {device ? (
          <Button
            variant="ghost"
            size="xs"
            style={styles.deviceLink}
            textStyle={settingsStyles.rowTitle}
            onPress={selectDevice}
          >
            {device.label}
          </Button>
        ) : null}
        <Text style={styles.meta}>
          {transportLabel(session.transport, t)} · {versionLabel(session.appVersion, t)}
        </Text>
      </View>
      <Text style={styles.meta}>{duration}</Text>
    </View>
  );
}

function clock(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function dayLabel(date: Date, t: ReturnType<typeof useTranslation>["t"]): string {
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return t("pairing.history.today");
  today.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return t("pairing.history.yesterday");
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function transportLabel(
  transport: ConnectionTransport,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const keys = {
    [ConnectionTransport.Relay]: "pairing.history.relay",
    [ConnectionTransport.DirectLocal]: "pairing.history.local",
    [ConnectionTransport.DirectNetwork]: "pairing.history.network",
    [ConnectionTransport.SshTunnel]: "pairing.history.ssh",
  } as const;
  return t(keys[transport]);
}

function versionLabel(
  version: string | undefined,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  return version ? `v${version.replace(/^v/, "")}` : t("pairing.history.unknownVersion");
}

const styles = StyleSheet.create((theme) => ({
  empty: {
    padding: theme.spacing[4],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  device: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  icon: {
    width: theme.spacing[8],
    height: theme.spacing[8],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  deviceBody: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: theme.spacing[2] },
  wideStatus: { display: { xs: "none", md: "flex" } },
  compactStatus: { display: { xs: "flex", md: "none" }, marginTop: theme.spacing[2] },
  status: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1.5] },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, flexShrink: 1 },
  dot: {
    width: theme.spacing[1.5],
    height: theme.spacing[1.5],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundMuted,
  },
  dotConnected: { backgroundColor: theme.colors.statusSuccess },
  session: { gap: theme.spacing[2], paddingVertical: theme.spacing[3], flexWrap: "wrap" },
  timestamp: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    minWidth: theme.spacing[12],
  },
  sessionBody: { flex: 1, minWidth: theme.spacing[16] },
  deviceLink: { alignSelf: "flex-start", paddingHorizontal: 0, height: "auto", minHeight: 0 },
  reset: { gap: theme.spacing[2], backgroundColor: theme.colors.statusWarningTint },
  warning: { color: theme.colors.statusWarning },
  resetLabel: { flex: 1, fontSize: theme.fontSize.sm },
}));
