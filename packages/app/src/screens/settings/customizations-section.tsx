import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@/components/settings";
import { useAppSettings, type AppSettings } from "@/hooks/use-settings";

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
