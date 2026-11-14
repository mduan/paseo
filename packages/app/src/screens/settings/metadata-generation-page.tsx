import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type {
  AgentModelDefinition,
  AgentProvider,
  ProviderSnapshotEntry,
} from "@getpaseo/protocol/agent-types";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { Alert } from "@/components/ui/alert";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { ExternalLink } from "@/components/ui/external-link";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostFeature } from "@/runtime/host-features";
import { buildSelectableProviderSelectorProviders } from "@/provider-selection/provider-selection";
import {
  resolveDefaultModel,
  resolveEffectiveModel,
  resolveThinkingOptionId,
} from "@/provider-selection/resolve-agent-form";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";

const METADATA_GENERATION_DOCS_URL = "https://paseo.sh/docs/metadata-generation";
type MetadataGenerationProvider = MutableDaemonConfig["metadataGeneration"]["providers"][number];
// oxlint-disable-next-line typescript/consistent-type-definitions -- AGENTS.md requires type aliases.
type MetadataEffortOptionProps = {
  option: NonNullable<AgentModelDefinition["thinkingOptions"]>[number];
  selected: boolean;
  disabled: boolean;
  onSelect: (thinkingOptionId: string) => void;
};

function MetadataEffortOption({ option, selected, disabled, onSelect }: MetadataEffortOptionProps) {
  const handleSelect = useCallback(() => onSelect(option.id), [onSelect, option.id]);
  return (
    <DropdownMenuItem selected={selected} disabled={disabled} onSelect={handleSelect}>
      {formatThinkingOptionLabel(option)}
    </DropdownMenuItem>
  );
}

// oxlint-disable-next-line typescript/consistent-type-definitions -- AGENTS.md requires type aliases.
type MetadataEffortRowProps = {
  provider: MetadataGenerationProvider;
  entries?: ProviderSnapshotEntry[];
  disabled: boolean;
  onSelect: (thinkingOptionId: string) => void;
  testID: string;
};

function MetadataEffortRow({
  provider,
  entries,
  disabled,
  onSelect,
  testID,
}: MetadataEffortRowProps) {
  const { t } = useTranslation();
  const models = entries?.find((entry) => entry.provider === provider.provider)?.models ?? [];
  const model = provider.model
    ? resolveEffectiveModel(models, provider.model)
    : resolveDefaultModel(models);
  const options = model?.thinkingOptions ?? [];
  const selectedOption = options.find((option) => option.id === provider.thinkingOptionId);
  if (!options.length) return null;

  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.metadataGeneration.effort")}</Text>
      </View>
      <DropdownMenu>
        <DropdownTrigger
          accessibilityRole="button"
          accessibilityLabel={t("agentControls.thinking.select")}
          disabled={disabled}
          testID={testID}
        >
          {selectedOption
            ? formatThinkingOptionLabel(selectedOption)
            : t("agentControls.thinking.select")}
        </DropdownTrigger>
        <DropdownMenuContent side="bottom" align="end" width={200}>
          {options.map((option) => (
            <MetadataEffortOption
              key={option.id}
              option={option}
              selected={option.id === provider.thinkingOptionId}
              disabled={disabled}
              onSelect={onSelect}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

type ModelProviders = MutableDaemonConfig["metadataGeneration"]["providers"];
type ProvidersSnapshot = ReturnType<typeof useProvidersSnapshot>;

/** Selection state for an ordered provider list where an empty list means "use the default". */
function useModelPreference({
  configuredProviders,
  snapshot,
  save,
}: {
  configuredProviders: ModelProviders | undefined;
  snapshot: ProvidersSnapshot;
  save: (providers: ModelProviders) => Promise<unknown>;
}) {
  const configuredProvider = configuredProviders?.[0];
  const [draftManual, setDraftManual] = useState<boolean>();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const isManual = draftManual ?? Boolean(configuredProvider);

  useEffect(() => {
    setDraftManual(undefined);
  }, [configuredProvider?.model, configuredProvider?.provider]);

  const runSave = useCallback(async (task: () => Promise<unknown>) => {
    setIsSaving(true);
    setSaveError(undefined);
    try {
      await task();
    } catch (error) {
      setDraftManual(undefined);
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, []);

  const saveProviders = useCallback(
    (providers: ModelProviders) => runSave(() => save(providers)),
    [runSave, save],
  );

  const setManual = useCallback(
    (next: boolean) => {
      setDraftManual(next);
      if (!next) void saveProviders([]);
    },
    [saveProviders],
  );

  const selectModel = useCallback(
    (provider: AgentProvider, model: string) => {
      const models = snapshot.entries?.find((entry) => entry.provider === provider)?.models ?? [];
      const isSameModel =
        configuredProvider?.provider === provider && configuredProvider.model === model;
      const thinkingOptionId = resolveThinkingOptionId({
        availableModels: models,
        modelId: model,
        requestedThinkingOptionId: isSameModel ? (configuredProvider.thinkingOptionId ?? "") : "",
      });
      setDraftManual(true);
      void saveProviders([
        {
          provider,
          ...(model ? { model } : {}),
          ...(thinkingOptionId ? { thinkingOptionId } : {}),
        },
        ...(configuredProviders?.slice(1) ?? []),
      ]);
    },
    [configuredProvider, configuredProviders, saveProviders, snapshot.entries],
  );

  const selectThinking = useCallback(
    (thinkingOptionId: string) => {
      if (!configuredProvider) return;
      void saveProviders([
        { ...configuredProvider, thinkingOptionId },
        ...(configuredProviders?.slice(1) ?? []),
      ]);
    },
    [configuredProvider, configuredProviders, saveProviders],
  );

  return {
    configuredProvider,
    isManual,
    isSaving,
    saveError,
    runSave,
    setManual,
    selectModel,
    selectThinking,
  };
}

type ModelPreference = ReturnType<typeof useModelPreference>;

function ModelPreferenceRows({
  serverId,
  snapshot,
  preference,
  labels,
  bordered,
  testID,
}: {
  serverId: string;
  snapshot: ProvidersSnapshot;
  preference: ModelPreference;
  labels: {
    defaultMode: string;
    defaultHint: string;
    manualHint: string;
    fallbackHint: string;
  };
  bordered: boolean;
  testID: string;
}) {
  const { t } = useTranslation();
  const { configuredProvider, isManual, isSaving, setManual, selectModel, selectThinking } =
    preference;
  const selectorProviders = useMemo(
    () => buildSelectableProviderSelectorProviders(snapshot.entries),
    [snapshot.entries],
  );
  const modeOptions = useMemo(
    () => [
      { value: "default" as const, label: labels.defaultMode, disabled: isSaving },
      {
        value: "manual" as const,
        label: t("settings.metadataGeneration.preferred"),
        disabled: isSaving,
      },
    ],
    [isSaving, labels.defaultMode, t],
  );
  const handleModeChange = useCallback(
    (next: "default" | "manual") => setManual(next === "manual"),
    [setManual],
  );
  const handleSelectorOpen = useCallback(() => {
    snapshot.refetchIfStale(configuredProvider?.provider);
  }, [configuredProvider?.provider, snapshot]);
  const handleRetryProvider = useCallback(
    (provider: AgentProvider) => snapshot.refresh([provider]),
    [snapshot],
  );

  return (
    <>
      <View style={bordered ? [settingsStyles.row, settingsStyles.rowBorder] : settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.metadataGeneration.selection")}</Text>
          <Text style={settingsStyles.rowHint}>
            {isManual ? labels.manualHint : labels.defaultHint}
          </Text>
        </View>
        <SegmentedControl
          options={modeOptions}
          value={isManual ? "manual" : "default"}
          onValueChange={handleModeChange}
          size="sm"
          testID={`${testID}-mode`}
        />
      </View>
      {isManual ? (
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.metadataGeneration.model")}</Text>
            <Text style={settingsStyles.rowHint}>{labels.fallbackHint}</Text>
          </View>
          <CombinedModelSelector
            providers={selectorProviders}
            selectedProvider={configuredProvider?.provider ?? ""}
            selectedModel={configuredProvider?.model ?? ""}
            onSelect={selectModel}
            isLoading={snapshot.isLoading || snapshot.isFetching}
            onOpen={handleSelectorOpen}
            onRetryProvider={handleRetryProvider}
            isRetryingProvider={snapshot.isRefreshing}
            disabled={isSaving}
            serverId={serverId}
            desktopPlacement="bottom-start"
            desktopMinWidth={360}
          />
        </View>
      ) : null}
      {isManual && configuredProvider ? (
        <MetadataEffortRow
          provider={configuredProvider}
          entries={snapshot.entries}
          disabled={isSaving}
          onSelect={selectThinking}
          testID={`${testID}-effort`}
        />
      ) : null}
    </>
  );
}

function SaveErrorAlert({ error }: { error: string | undefined }) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <Alert variant="error" title={t("settings.metadataGeneration.saveError")} description={error} />
  );
}

export function MetadataGenerationPage({ serverId }: { serverId: string }) {
  const { config, isLoading: isConfigLoading, patchConfig } = useDaemonConfig(serverId);
  const snapshot = useProvidersSnapshot(serverId);
  const supportsSuggestions = useHostFeature(serverId, "suggestedNextActions");

  if (isConfigLoading || !config) {
    return (
      <View style={styles.loading}>
        <LoadingSpinner size="large" color={styles.spinnerColor.color} />
      </View>
    );
  }

  return (
    <View>
      <MetadataGenerationSection
        serverId={serverId}
        config={config}
        patchConfig={patchConfig}
        snapshot={snapshot}
      />
      {supportsSuggestions ? (
        <SuggestedNextActionsSection
          serverId={serverId}
          config={config}
          patchConfig={patchConfig}
          snapshot={snapshot}
        />
      ) : null}
    </View>
  );
}

interface SectionProps {
  serverId: string;
  config: MutableDaemonConfig;
  patchConfig: ReturnType<typeof useDaemonConfig>["patchConfig"];
  snapshot: ProvidersSnapshot;
}

function MetadataGenerationSection({ serverId, config, patchConfig, snapshot }: SectionProps) {
  const { t } = useTranslation();
  const save = useCallback(
    (providers: ModelProviders) => patchConfig({ metadataGeneration: { providers } }),
    [patchConfig],
  );
  const preference = useModelPreference({
    configuredProviders: config.metadataGeneration.providers,
    snapshot,
    save,
  });
  const labels = useMemo(
    () => ({
      defaultMode: t("settings.metadataGeneration.automatic"),
      defaultHint: t("settings.metadataGeneration.automaticHint"),
      manualHint: t("settings.metadataGeneration.preferredHint"),
      fallbackHint: t("settings.metadataGeneration.fallbackHint"),
    }),
    [t],
  );
  const docsLink = useMemo(
    () => (
      <ExternalLink
        href={METADATA_GENERATION_DOCS_URL}
        label={t("settings.metadataGeneration.docs")}
      />
    ),
    [t],
  );

  return (
    <SettingsSection
      title={t("settings.metadataGeneration.title")}
      info={t("settings.metadataGeneration.description")}
      trailing={docsLink}
      testID="metadata-generation-settings"
    >
      <SaveErrorAlert error={preference.saveError} />
      <View style={settingsStyles.card}>
        <ModelPreferenceRows
          serverId={serverId}
          snapshot={snapshot}
          preference={preference}
          labels={labels}
          bordered={false}
          testID="metadata-generation"
        />
      </View>
    </SettingsSection>
  );
}

function SuggestedNextActionsSection({ serverId, config, patchConfig, snapshot }: SectionProps) {
  const { t } = useTranslation();
  const suggested = config.metadataGeneration.suggestedNextActions;
  const enabled = suggested?.enabled === true;
  const save = useCallback(
    (providers: ModelProviders) =>
      patchConfig({ metadataGeneration: { suggestedNextActions: { providers } } }),
    [patchConfig],
  );
  const preference = useModelPreference({
    configuredProviders: suggested?.providers,
    snapshot,
    save,
  });
  const { runSave } = preference;
  const handleEnabledChange = useCallback(
    (next: boolean) =>
      void runSave(() =>
        patchConfig({ metadataGeneration: { suggestedNextActions: { enabled: next } } }),
      ),
    [patchConfig, runSave],
  );
  const labels = useMemo(
    () => ({
      defaultMode: t("settings.suggestedNextActions.sameAsMetadata"),
      defaultHint: t("settings.suggestedNextActions.sameAsMetadataHint"),
      manualHint: t("settings.suggestedNextActions.manualHint"),
      fallbackHint: t("settings.suggestedNextActions.fallbackHint"),
    }),
    [t],
  );

  return (
    <SettingsSection
      title={t("settings.suggestedNextActions.title")}
      info={t("settings.suggestedNextActions.description")}
      testID="suggested-next-actions-settings"
    >
      <SaveErrorAlert error={preference.saveError} />
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.suggestedNextActions.enable")}</Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.suggestedNextActions.enableHint")}
            </Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={handleEnabledChange}
            disabled={preference.isSaving}
            accessibilityLabel={t("settings.suggestedNextActions.enable")}
            testID="suggested-next-actions-switch"
          />
        </View>
        {enabled ? (
          <ModelPreferenceRows
            serverId={serverId}
            snapshot={snapshot}
            preference={preference}
            labels={labels}
            bordered
            testID="suggested-next-actions"
          />
        ) : null}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  loading: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 180,
  },
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
}));
