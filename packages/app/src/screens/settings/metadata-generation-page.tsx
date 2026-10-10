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
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { Alert } from "@/components/ui/alert";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { ExternalLink } from "@/components/ui/external-link";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { buildSelectableProviderSelectorProviders } from "@/provider-selection/provider-selection";
import {
  resolveDefaultModel,
  resolveEffectiveModel,
  resolveThinkingOptionId,
} from "@/provider-selection/resolve-agent-form";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";

const METADATA_GENERATION_DOCS_URL = "https://paseo.sh/docs/metadata-generation";
type SelectionMode = "automatic" | "preferred";
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
      {option.label}
    </DropdownMenuItem>
  );
}

// oxlint-disable-next-line typescript/consistent-type-definitions -- AGENTS.md requires type aliases.
type MetadataEffortRowProps = {
  provider: MetadataGenerationProvider;
  entries?: ProviderSnapshotEntry[];
  disabled: boolean;
  onSelect: (thinkingOptionId: string) => void;
};

function MetadataEffortRow({ provider, entries, disabled, onSelect }: MetadataEffortRowProps) {
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
          testID="metadata-generation-effort"
        >
          {selectedOption?.label ?? t("agentControls.thinking.select")}
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

export function MetadataGenerationPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { config, isLoading: isConfigLoading, patchConfig } = useDaemonConfig(serverId);
  const snapshot = useProvidersSnapshot(serverId);
  const providers = useMemo(
    () => buildSelectableProviderSelectorProviders(snapshot.entries),
    [snapshot.entries],
  );
  const configuredProviders = config?.metadataGeneration.providers;
  const configuredProvider = configuredProviders?.[0];
  const savedMode: SelectionMode = configuredProvider ? "preferred" : "automatic";
  const [draftMode, setDraftMode] = useState<SelectionMode | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const mode = draftMode ?? savedMode;

  useEffect(() => {
    setDraftMode(null);
  }, [configuredProvider?.model, configuredProvider?.provider]);

  const modeOptions = useMemo(
    () => [
      {
        value: "automatic" as const,
        label: t("settings.metadataGeneration.automatic"),
        disabled: isSaving,
      },
      {
        value: "preferred" as const,
        label: t("settings.metadataGeneration.preferred"),
        disabled: isSaving,
      },
    ],
    [isSaving, t],
  );

  const saveProviders = useCallback(
    async (providersPatch: MutableDaemonConfig["metadataGeneration"]["providers"]) => {
      setIsSaving(true);
      setSaveError(undefined);
      try {
        await patchConfig({ metadataGeneration: { providers: providersPatch } });
      } catch (error) {
        setDraftMode(null);
        setSaveError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsSaving(false);
      }
    },
    [patchConfig],
  );

  const handleModeChange = useCallback(
    (next: SelectionMode) => {
      setDraftMode(next);
      if (next === "automatic") {
        void saveProviders([]);
      }
    },
    [saveProviders],
  );

  const handleModelSelect = useCallback(
    (provider: AgentProvider, model: string) => {
      const models = snapshot.entries?.find((entry) => entry.provider === provider)?.models ?? [];
      const isSameModel =
        configuredProvider?.provider === provider && configuredProvider.model === model;
      const thinkingOptionId = resolveThinkingOptionId({
        availableModels: models,
        modelId: model,
        requestedThinkingOptionId: isSameModel ? (configuredProvider.thinkingOptionId ?? "") : "",
      });
      setDraftMode("preferred");
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

  const handleThinkingSelect = useCallback(
    (thinkingOptionId: string) => {
      if (!configuredProvider) return;
      void saveProviders([
        { ...configuredProvider, thinkingOptionId },
        ...(configuredProviders?.slice(1) ?? []),
      ]);
    },
    [configuredProvider, configuredProviders, saveProviders],
  );

  const handleSelectorOpen = useCallback(() => {
    snapshot.refetchIfStale(configuredProvider?.provider);
  }, [configuredProvider?.provider, snapshot]);
  const handleRetryProvider = useCallback(
    (provider: AgentProvider) => snapshot.refresh([provider]),
    [snapshot],
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

  if (isConfigLoading || !config) {
    return (
      <View style={styles.loading}>
        <LoadingSpinner size="large" color={styles.spinnerColor.color} />
      </View>
    );
  }

  return (
    <SettingsSection
      title={t("settings.metadataGeneration.title")}
      info={t("settings.metadataGeneration.description")}
      trailing={docsLink}
      testID="metadata-generation-settings"
    >
      {saveError ? (
        <Alert
          variant="error"
          title={t("settings.metadataGeneration.saveError")}
          description={saveError}
        />
      ) : null}
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.metadataGeneration.selection")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {mode === "automatic"
                ? t("settings.metadataGeneration.automaticHint")
                : t("settings.metadataGeneration.preferredHint")}
            </Text>
          </View>
          <SegmentedControl
            options={modeOptions}
            value={mode}
            onValueChange={handleModeChange}
            size="sm"
            testID="metadata-generation-mode"
          />
        </View>
        {mode === "preferred" ? (
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.metadataGeneration.model")}</Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.metadataGeneration.fallbackHint")}
              </Text>
            </View>
            <CombinedModelSelector
              providers={providers}
              selectedProvider={configuredProvider?.provider ?? ""}
              selectedModel={configuredProvider?.model ?? ""}
              onSelect={handleModelSelect}
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
        {mode === "preferred" && configuredProvider ? (
          <MetadataEffortRow
            provider={configuredProvider}
            entries={snapshot.entries}
            disabled={isSaving}
            onSelect={handleThinkingSelect}
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
