import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@/components/settings";
import { useAppSettings, type AppSettings } from "@/hooks/use-settings";
import { UsageAutoRefresh } from "@/usage/preferences";

const CUSTOMIZATIONS = [
  "turnDiffs",
  "keepChatPosition",
  "sidebarAgentRows",
  "sidebarTerminalRows",
  "sidebarBrowserRows",
] as const satisfies readonly (keyof AppSettings)[];

type Customization = (typeof CUSTOMIZATIONS)[number];

export function CustomizationsSection() {
  const { t } = useTranslation();
  return (
    <SettingsSection title={t("settings.customizations.all")}>
      <SettingsCard>
        {CUSTOMIZATIONS.map((key) => (
          <CustomizationSwitch key={key} customization={key} />
        ))}
        <UsageAutoRefreshSelect />
      </SettingsCard>
    </SettingsSection>
  );
}

function CustomizationSwitch({ customization }: { customization: Customization }) {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const handleChange = useCallback(
    (value: boolean) => void updateSettings({ [customization]: value }),
    [customization, updateSettings],
  );
  return (
    <SettingsSwitch
      label={t(`settings.customizations.${customization}.title`)}
      hint={t(`settings.customizations.${customization}.description`)}
      value={settings[customization]}
      onValueChange={handleChange}
    />
  );
}

function UsageAutoRefreshSelect() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const options = useMemo(
    () =>
      Object.values(UsageAutoRefresh).map((value) => ({
        value,
        label: t(`settings.customizations.usageAutoRefresh.options.${value}`),
      })),
    [t],
  );
  const handleChange = useCallback(
    (value: UsageAutoRefresh) => void updateSettings({ usageAutoRefresh: value }),
    [updateSettings],
  );
  return (
    <SettingsSelect
      label={t("settings.customizations.usageAutoRefresh.title")}
      hint={t("settings.customizations.usageAutoRefresh.description")}
      value={settings.usageAutoRefresh}
      options={options}
      onValueChange={handleChange}
    />
  );
}
