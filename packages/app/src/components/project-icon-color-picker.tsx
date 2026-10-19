import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type LayoutChangeEvent, Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import Svg, { Defs, Line, LinearGradient, Pattern, Rect, Stop } from "react-native-svg";
import { Plus } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { IDENTITY_COLOR_NAMES, identityColor } from "@/styles/identity-colors";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { type HsvColor, hexToHsv, hsvToHex, parseHexColor } from "@/utils/hex-color";

const SWATCH_SIZE = 28;
const SV_HEIGHT = 120;
const HUE_HEIGHT = 12;
const KNOB_SIZE = 14;
const HUE_STOPS = ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"].map(
  (color, index, all) => ({ color, offset: index / (all.length - 1) }),
);
// Built once, as elements: LinearGradient reads its Stops' props directly, so they cannot sit
// behind a wrapper component.
const HUE_STOP_ELEMENTS = HUE_STOPS.map((stop) => (
  <Stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
));
const PRESETS = IDENTITY_COLOR_NAMES.map((name) => ({ name, hex: identityColor(name) }));
const PRESET_HEXES = new Set(PRESETS.map((preset) => preset.hex));
/** Where Custom starts when the project has no color of its own yet. */
const CUSTOM_SEED = "#3a7bd5";

const ThemedPlus = withUnistyles(Plus);
const plusColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Auto, the ten presets, and a Custom swatch that opens a saturation/brightness square, a hue
 * slider and a hex field. Picking Auto or a preset is the whole decision, so the parent closes
 * on `onCommit`; Custom stays open while you drag until Done.
 */
export function ProjectIconColorPicker({
  value,
  derivedColor,
  onChange,
  onCommit,
}: {
  /** The staged #rrggbb, null while the icon uses the derived color. */
  value: string | null;
  derivedColor: string;
  onChange: (color: string | null) => void;
  /** The choice is final: close the picker. */
  onCommit: () => void;
}) {
  const { t } = useTranslation();
  const isCustomValue = value !== null && !PRESET_HEXES.has(value);
  const [customOpen, setCustomOpen] = useState(isCustomValue);
  // Hue lives here rather than being re-derived from the hex: a grey or black has no hue, and
  // dragging through one must not snap the slider back to red.
  const [hsv, setHsv] = useState<HsvColor>(() => hexToHsv(isCustomValue ? value : CUSTOM_SEED));
  const [hexResetKey, setHexResetKey] = useState(0);
  const customHex = hsvToHex(hsv);

  const applyHsv = useCallback(
    (next: HsvColor) => {
      setHsv(next);
      setHexResetKey((key) => key + 1);
      onChange(hsvToHex(next));
    },
    [onChange],
  );

  const selectAuto = useCallback(() => {
    onChange(null);
    onCommit();
  }, [onChange, onCommit]);

  const selectPreset = useCallback(
    (hex: string) => {
      onChange(hex);
      onCommit();
    },
    [onChange, onCommit],
  );

  const openCustom = useCallback(() => {
    setCustomOpen(true);
    onChange(customHex);
  }, [customHex, onChange]);

  const handleHexText = useCallback(
    (text: string) => {
      const hex = parseHexColor(text);
      if (!hex) return;
      setHsv(hexToHsv(hex));
      onChange(hex);
    },
    [onChange],
  );

  return (
    <View style={styles.body} testID="project-icon-color-picker">
      <View style={styles.swatches}>
        <AutoSwatch
          color={derivedColor}
          selected={value === null}
          label={t("settings.project.edit.color.auto")}
          onPress={selectAuto}
        />
        {PRESETS.map((preset) => (
          <PresetSwatch
            key={preset.name}
            hex={preset.hex}
            selected={!customOpen && value === preset.hex}
            label={t(`settings.host.appearance.color.options.${preset.name}`)}
            onSelect={selectPreset}
          />
        ))}
        <CustomSwatch
          selected={customOpen}
          label={t("settings.project.edit.color.custom")}
          onPress={openCustom}
        />
      </View>
      {customOpen ? (
        <View style={styles.customPane}>
          <SaturationValueSquare hsv={hsv} onChange={applyHsv} />
          <HueSlider hsv={hsv} onChange={applyHsv} />
          <View style={styles.hexRow}>
            <View style={[styles.hexChip, { backgroundColor: customHex }]} />
            <View style={styles.hexInput}>
              <FormTextInput
                size="sm"
                testID="project-icon-color-hex"
                accessibilityLabel={t("settings.project.edit.color.hex")}
                initialValue={customHex}
                resetKey={hexResetKey}
                onChangeText={handleHexText}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={7}
              />
            </View>
          </View>
          <View style={styles.doneRow}>
            <Button variant="outline" size="sm" onPress={onCommit} testID="project-icon-color-done">
              {t("settings.project.edit.color.done")}
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function SwatchFrame({
  selected,
  label,
  onPress,
  testID,
  children,
}: {
  selected: boolean;
  label: string;
  onPress: () => void;
  testID: string;
  children: ReactNode;
}) {
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.swatch, selected && styles.swatchSelected]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

function PresetSwatch({
  hex,
  selected,
  label,
  onSelect,
}: {
  hex: string;
  selected: boolean;
  label: string;
  onSelect: (hex: string) => void;
}) {
  const handlePress = useCallback(() => onSelect(hex), [hex, onSelect]);
  return (
    <SwatchFrame
      selected={selected}
      label={label}
      onPress={handlePress}
      testID={`project-icon-color-${hex}`}
    >
      <View style={[styles.swatchFill, { backgroundColor: hex }]} />
    </SwatchFrame>
  );
}

/** Stripes of the derived color: "whatever it would have been", not a color of its own. */
function AutoSwatch({
  color,
  selected,
  label,
  onPress,
}: {
  color: string;
  selected: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <SwatchFrame
      selected={selected}
      label={label}
      onPress={onPress}
      testID="project-icon-color-auto"
    >
      <View style={styles.swatchFill}>
        <Svg width={SWATCH_SIZE} height={SWATCH_SIZE}>
          <Defs>
            <Pattern
              id="project-icon-color-auto-stripes"
              width={6}
              height={6}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <Rect width={6} height={6} fill="#ffffff" />
              <Line x1={0} y1={0} x2={0} y2={6} stroke={color} strokeWidth={8} />
            </Pattern>
          </Defs>
          <Rect
            width={SWATCH_SIZE}
            height={SWATCH_SIZE}
            fill="url(#project-icon-color-auto-stripes)"
          />
        </Svg>
      </View>
    </SwatchFrame>
  );
}

function CustomSwatch({
  selected,
  label,
  onPress,
}: {
  selected: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <SwatchFrame
      selected={selected}
      label={label}
      onPress={onPress}
      testID="project-icon-color-custom"
    >
      <View style={styles.swatchFill}>
        <Svg width={SWATCH_SIZE} height={SWATCH_SIZE} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="project-icon-color-rainbow" x1="0" y1="0" x2="1" y2="1">
              {HUE_STOP_ELEMENTS}
            </LinearGradient>
          </Defs>
          <Rect
            width={SWATCH_SIZE}
            height={SWATCH_SIZE}
            fill="url(#project-icon-color-rainbow)"
            opacity={0.75}
          />
        </Svg>
        <View style={styles.customBadge}>
          <ThemedPlus size={ICON_SIZE.xs} uniProps={plusColorMapping} />
        </View>
      </View>
    </SwatchFrame>
  );
}

/** Tracks a drag across a box and reports the pointer as 0–1 fractions of its size. */
function useDragFractions(onDrag: (x: number, y: number) => void) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  }, []);
  const gesture = useMemo(() => {
    const report = (event: { x: number; y: number }) => {
      if (size.width <= 0 || size.height <= 0) return;
      onDrag(clamp01(event.x / size.width), clamp01(event.y / size.height));
    };
    // minDistance(0) claims the touch on contact, so the surrounding sheet does not read the
    // drag as a pan-to-dismiss and a plain tap still picks a color.
    return Gesture.Pan().runOnJS(true).minDistance(0).onBegin(report).onUpdate(report);
  }, [onDrag, size.height, size.width]);
  return { gesture, handleLayout, size };
}

function SaturationValueSquare({
  hsv,
  onChange,
}: {
  hsv: HsvColor;
  onChange: (next: HsvColor) => void;
}) {
  const handleDrag = useCallback(
    (x: number, y: number) => onChange({ h: hsv.h, s: x, v: 1 - y }),
    [hsv.h, onChange],
  );
  const { gesture, handleLayout, size } = useDragFractions(handleDrag);
  const pureHue = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  return (
    <GestureDetector gesture={gesture}>
      <View
        style={[styles.svSquare, { backgroundColor: pureHue }]}
        onLayout={handleLayout}
        collapsable={false}
      >
        <Svg width={size.width} height={SV_HEIGHT} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="project-icon-color-white" x1="0" y1="0" x2="1" y2="0">
              <Stop offset={0} stopColor="#ffffff" stopOpacity={1} />
              <Stop offset={1} stopColor="#ffffff" stopOpacity={0} />
            </LinearGradient>
            <LinearGradient id="project-icon-color-black" x1="0" y1="0" x2="0" y2="1">
              <Stop offset={0} stopColor="#000000" stopOpacity={0} />
              <Stop offset={1} stopColor="#000000" stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#project-icon-color-white)" />
          <Rect width="100%" height="100%" fill="url(#project-icon-color-black)" />
        </Svg>
        <View
          pointerEvents="none"
          style={[
            styles.knob,
            {
              left: hsv.s * size.width - KNOB_SIZE / 2,
              top: (1 - hsv.v) * SV_HEIGHT - KNOB_SIZE / 2,
              backgroundColor: hsvToHex(hsv),
            },
          ]}
        />
      </View>
    </GestureDetector>
  );
}

function HueSlider({ hsv, onChange }: { hsv: HsvColor; onChange: (next: HsvColor) => void }) {
  const handleDrag = useCallback(
    (x: number) => onChange({ ...hsv, h: Math.min(x * 360, 359.9) }),
    [hsv, onChange],
  );
  const { gesture, handleLayout, size } = useDragFractions(handleDrag);
  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.hueTrack} onLayout={handleLayout} collapsable={false}>
        <Svg width={size.width} height={HUE_HEIGHT} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="project-icon-color-hue" x1="0" y1="0" x2="1" y2="0">
              {HUE_STOP_ELEMENTS}
            </LinearGradient>
          </Defs>
          <Rect
            width="100%"
            height="100%"
            rx={HUE_HEIGHT / 2}
            fill="url(#project-icon-color-hue)"
          />
        </Svg>
        <View
          pointerEvents="none"
          style={[
            styles.knob,
            {
              left: (hsv.h / 360) * size.width - KNOB_SIZE / 2,
              top: (HUE_HEIGHT - KNOB_SIZE) / 2,
              backgroundColor: hsvToHex({ h: hsv.h, s: 1, v: 1 }),
            },
          ]}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    padding: theme.spacing[3],
    gap: theme.spacing[3],
  },
  swatches: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  swatch: {
    width: SWATCH_SIZE,
    height: SWATCH_SIZE,
    borderRadius: theme.borderRadius.md,
  },
  swatchSelected: {
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineColor: theme.colors.foreground,
    outlineOffset: 2,
  },
  swatchFill: {
    flex: 1,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  customBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  customPane: {
    gap: theme.spacing[3],
    paddingTop: theme.spacing[3],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  svSquare: {
    height: SV_HEIGHT,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
  },
  hueTrack: {
    height: HUE_HEIGHT,
    marginHorizontal: KNOB_SIZE / 2,
  },
  knob: {
    position: "absolute",
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    borderWidth: 2,
    borderColor: "#ffffff",
    shadowColor: "#000000",
    shadowOpacity: 0.3,
    shadowRadius: 1,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  hexRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  hexChip: {
    width: SWATCH_SIZE,
    height: SWATCH_SIZE,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  hexInput: {
    flex: 1,
  },
  doneRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
}));
