/* eslint-disable typescript/consistent-type-definitions -- Workspace instructions require type aliases. */
import { Fragment, useCallback } from "react";
import { Text } from "react-native";
import { Settings2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { toolbarLabelTriggerStyle } from "@/components/ui/toolbar-label-trigger";
import {
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuSurface,
  MenuTrigger,
  type MenuTriggerState,
} from "@/components/ui/menu";
import { buttonControlHeight } from "@/components/ui/control-geometry";
import type { Theme } from "@/styles/theme";
import { HistoryField, type HistoryFields } from "./preferences";

const ThemedSettings = withUnistyles(Settings2);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const FIELD_GROUPS = [
  [
    HistoryField.Project,
    HistoryField.WorkspaceName,
    HistoryField.Workspace,
    HistoryField.Branch,
    HistoryField.LinearTickets,
    HistoryField.Host,
  ],
  [
    HistoryField.Provider,
    HistoryField.Model,
    HistoryField.Effort,
    HistoryField.Turns,
    HistoryField.Cost,
  ],
  [HistoryField.Subagent, HistoryField.Status, HistoryField.LastActivity],
];

type HistoryDisplayMenuProps = {
  fields: HistoryFields;
  onToggle: (field: HistoryField) => void;
};

type HistoryFieldItemProps = Pick<HistoryDisplayMenuProps, "onToggle"> & {
  field: HistoryField;
  selected: boolean;
};

function HistoryFieldItem({ field, selected, onToggle }: HistoryFieldItemProps) {
  const { t } = useTranslation();
  const toggle = useCallback(() => onToggle(field), [field, onToggle]);
  return (
    <MenuItem
      selected={selected}
      closeOnSelect={false}
      onSelect={toggle}
      testID={`sessions-display-${field}`}
    >
      {t(`sessions.display.fields.${field}`)}
    </MenuItem>
  );
}

export function HistoryDisplayMenu({ fields, onToggle }: HistoryDisplayMenuProps) {
  const { t } = useTranslation();
  return (
    <MenuRoot compactMode="sheet">
      <MenuTrigger
        accessibilityRole="button"
        accessibilityLabel={t("sessions.display.title")}
        testID="sessions-display-trigger"
        style={displayTriggerStyle}
      >
        <ThemedSettings size={14} uniProps={mutedIconMapping} />
        <Text style={styles.triggerText}>{t("sessions.display.title")}</Text>
      </MenuTrigger>
      <MenuSurface
        align="end"
        width={220}
        sheetTitle={t("sessions.display.title")}
        testID="sessions-display-menu"
      >
        {FIELD_GROUPS.map((group, index) => (
          <Fragment key={group[0]}>
            {index > 0 ? <MenuSeparator /> : null}
            {group.map((field) => (
              <HistoryFieldItem
                key={field}
                field={field}
                selected={fields[field]}
                onToggle={onToggle}
              />
            ))}
          </Fragment>
        ))}
      </MenuSurface>
    </MenuRoot>
  );
}

function displayTriggerStyle(state: MenuTriggerState) {
  return [toolbarLabelTriggerStyle(state), styles.trigger];
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    minHeight: buttonControlHeight.sm,
    paddingHorizontal: theme.spacing[2],
  },
  triggerText: { fontSize: theme.fontSize.base, color: theme.colors.foregroundMuted },
}));
