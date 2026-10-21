/* oxlint-disable typescript/consistent-type-definitions -- AGENTS.md requires type aliases. */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { LinearConnectionStatus, type LinearConnection } from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { SettingsCard, SettingsSection } from "@/components/settings";
import { LinearIcon } from "@/components/icons/linear-icon";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { useFetchQuery } from "@/data/query";
import { openLinearKeyForm } from "./linear-key-form-model";

const ThemedLinear = withUnistyles(LinearIcon);
const ThemedFormTextInput = withUnistyles(FormTextInput);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const connectionKey = (serverId: string) => ["linear-connection", serverId] as const;

type KeyFormProps = {
  client: DaemonClient;
  enabled: boolean;
  onCancel(): void;
  onSaved(connection: LinearConnection): void;
};

function LinearKeyForm({ client, enabled, onCancel, onSaved }: KeyFormProps) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const size = compact ? "md" : "sm";
  const [model] = useState(openLinearKeyForm);
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  useEffect(() => () => model.close(), [model]);
  const save = useMutation({
    gcTime: 0,
    mutationFn: () => client.setLinearKey(model.getState().apiKey.trim()),
    onSuccess(connection) {
      model.close();
      onSaved(connection);
    },
  });
  const { mutate: saveKey } = save;
  const disabled = !enabled || save.isPending;
  const VisibilityIcon = state.isVisible ? EyeOff : Eye;
  const submit = useCallback(() => {
    if (state.canSubmit && !disabled) saveKey();
  }, [state.canSubmit, disabled, saveKey]);
  const createKeyLink = useMemo(
    () => (
      <ExternalLink href="https://linear.app/settings/api" label={t("settings.linear.createKey")} />
    ),
    [t],
  );

  return (
    <View style={styles.form} testID="linear-key-form">
      <Field label={t("settings.linear.apiKey")} trailing={createKeyLink}>
        <View>
          <ThemedFormTextInput
            size={size}
            onChangeText={model.setApiKey}
            placeholder={t("settings.linear.placeholder")}
            accessibilityLabel={t("settings.linear.apiKey")}
            testID="linear-api-key"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            maxLength={4096}
            secureTextEntry={!state.isVisible}
            editable={!disabled}
            onSubmitEditing={submit}
            style={styles.keyInput}
          />
          <View style={styles.visibility}>
            <Button
              variant="ghost"
              size="xs"
              leftIcon={VisibilityIcon}
              accessibilityLabel={
                state.isVisible ? t("settings.linear.hideKey") : t("settings.linear.showKey")
              }
              onPress={model.toggleVisibility}
              disabled={disabled}
            />
          </View>
        </View>
      </Field>
      {save.error ? (
        <Text accessibilityRole="alert" style={settingsStyles.rowError} testID="linear-save-error">
          {save.error.message}
        </Text>
      ) : null}
      <View style={styles.formActions}>
        <Button variant="outline" size={size} onPress={onCancel} disabled={save.isPending}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          size={size}
          onPress={submit}
          loading={save.isPending}
          disabled={disabled || !state.canSubmit}
        >
          {save.isPending ? t("settings.linear.checking") : t("settings.linear.saveKey")}
        </Button>
      </View>
    </View>
  );
}

type CardProps = {
  client: DaemonClient;
  serverId: string;
  connection: LinearConnection;
  enabled: boolean;
};

function LinearIntegrationCard({ client, serverId, connection, enabled }: CardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(connection.status === LinearConnectionStatus.Disconnected);
  const saved = useCallback(
    (next: LinearConnection) => {
      queryClient.setQueryData(connectionKey(serverId), next);
      setEditing(false);
    },
    [queryClient, serverId],
  );
  const startEditing = useCallback(() => setEditing(true), []);
  const cancelEditing = useCallback(() => setEditing(false), []);
  const disconnect = useMutation({
    mutationFn: () => client.disconnectLinear(),
    onSuccess(next) {
      queryClient.setQueryData(connectionKey(serverId), next);
      setEditing(true);
    },
  });
  const { mutate: disconnectKey } = disconnect;
  const handleDisconnect = useCallback(() => disconnectKey(), [disconnectKey]);
  const connected = connection.status === LinearConnectionStatus.Connected;
  const status = connected
    ? t("settings.linear.connected", { organization: connection.organizationName })
    : t("settings.linear.notConnected");

  return (
    <SettingsCard testID="linear-integration-card">
      <View style={[settingsStyles.row, styles.header]}>
        <View style={styles.identity}>
          <ThemedLinear size={20} uniProps={mutedColor} />
          <View>
            <Text style={settingsStyles.rowTitle}>Linear</Text>
            <Text style={settingsStyles.rowHint} testID="linear-connection-status">
              {status}
            </Text>
          </View>
        </View>
        {!editing ? (
          <View style={styles.actions}>
            <Button
              variant="outline"
              size="sm"
              onPress={startEditing}
              disabled={!enabled || disconnect.isPending}
            >
              {connected ? t("settings.linear.replaceKey") : t("settings.linear.addKey")}
            </Button>
            {connected ? (
              <Button
                variant="outline"
                size="sm"
                onPress={handleDisconnect}
                loading={disconnect.isPending}
                disabled={!enabled || disconnect.isPending}
              >
                {t("settings.linear.disconnect")}
              </Button>
            ) : null}
          </View>
        ) : null}
      </View>
      {editing ? (
        <LinearKeyForm client={client} enabled={enabled} onCancel={cancelEditing} onSaved={saved} />
      ) : null}
      {disconnect.error ? (
        <View style={styles.notice}>
          <Text
            accessibilityRole="alert"
            style={settingsStyles.rowError}
            testID="linear-disconnect-error"
          >
            {disconnect.error.message}
          </Text>
        </View>
      ) : null}
      {!enabled ? (
        <View style={styles.notice}>
          <Text style={settingsStyles.rowHint}>{t("settings.linear.offline")}</Text>
        </View>
      ) : null}
    </SettingsCard>
  );
}

export function HostIntegrationsPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supported = useHostFeature(serverId, "linearIntegration");
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    retry: false,
    queryKey: connectionKey(serverId),
    enabled: Boolean(client && isConnected && supported),
    queryFn: () => {
      if (!client) throw new Error(t("settings.linear.offline"));
      return client.getLinearConnection();
    },
  });
  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  let content;
  if (!isConnected && !query.data) content = <Alert description={t("settings.linear.offline")} />;
  else if (isConnected && !supported)
    content = <Alert description={t("settings.linear.updateHost")} />;
  else if (query.error)
    content = (
      <Alert variant="error" description={query.error.message}>
        <Button variant="outline" size="sm" onPress={retry}>
          {t("common.actions.retry")}
        </Button>
      </Alert>
    );
  else if (query.data && client)
    content = (
      <LinearIntegrationCard
        key={serverId}
        client={client}
        serverId={serverId}
        connection={query.data}
        enabled={isConnected}
      />
    );
  else content = <Text style={settingsStyles.rowHint}>{t("common.loading")}</Text>;

  return <SettingsSection title="Linear">{content}</SettingsSection>;
}

const styles = StyleSheet.create((theme) => ({
  header: { flexWrap: "wrap", gap: theme.spacing[3] },
  identity: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  form: { padding: theme.spacing[4], gap: theme.spacing[3] },
  keyInput: {
    backgroundColor: theme.colors.surface0,
    paddingRight: theme.spacing[12],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  visibility: {
    position: "absolute",
    right: theme.spacing[1],
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    marginTop: theme.spacing[3],
  },
  notice: { padding: theme.spacing[4] },
}));
