import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { PaneFind, findShortcutPlatform, isFindShortcut, type PaneFindHandle } from "@/pane-find";
import { isWeb } from "@/constants/platform";
import { hasActiveWebOverlay } from "@/lib/overlay-root";
import { isImeComposingKeyboardEvent } from "@/utils/keyboard-ime";
import type { TerminalEmulatorHandle } from "@/components/terminal-emulator-contract";
import type { SearchOptions } from "@getpaseo/protocol/search/options";
import { SearchOptionGroup } from "@/components/sessions/search-options";
import { TerminalFindDirection } from "./direction";
import type { TerminalFindResult } from "../runtime/terminal-emulator-runtime";

export interface TerminalPaneFindHandle {
  open(): void;
  update(result: TerminalFindResult): void;
  reset(): void;
}

export const TerminalFind = forwardRef<
  TerminalPaneFindHandle,
  {
    terminal: RefObject<TerminalEmulatorHandle | null>;
    active: boolean;
    focusTerminal(): void;
  }
>(function TerminalFind({ terminal, active, focusTerminal }, ref) {
  const { t } = useTranslation();
  const widget = useRef<PaneFindHandle>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SearchOptions>({});
  const [result, setResult] = useState<TerminalFindResult>({
    resultIndex: -1,
    resultCount: 0,
    limited: false,
    invalid: false,
    placement: "top",
  });
  const show = useCallback(() => {
    if (!active || !terminal.current?.find) return;
    if (!open && query) terminal.current.find.search({ query, options });
    setOpen(true);
    widget.current?.focus();
  }, [active, open, query, options, terminal]);
  useImperativeHandle(
    ref,
    () => ({
      open: show,
      update: setResult,
      reset: () => {
        setOpen(false);
        setQuery("");
        setOptions({});
      },
    }),
    [show],
  );
  useEffect(() => {
    if (!isWeb || !active) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || hasActiveWebOverlay() || isImeComposingKeyboardEvent(event))
        return;
      if (isFindShortcut(event, findShortcutPlatform()) && terminal.current?.find) {
        event.preventDefault();
        show();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, show, terminal]);
  const search = useCallback(
    (text: string) => {
      setQuery(text);
      terminal.current?.find?.search({ query: text, options });
    },
    [terminal, options],
  );
  const changeOptions = useCallback(
    (value: SearchOptions) => {
      setOptions(value);
      terminal.current?.find?.search({ query, options: value });
    },
    [query, terminal],
  );
  const optionControls = useMemo(
    () => (
      <SearchOptionGroup
        value={options}
        supported
        onChange={changeOptions}
        dense
        testIDPrefix="terminal-find"
      />
    ),
    [options, changeOptions],
  );
  const next = useCallback(
    () => terminal.current?.find?.search({ query, direction: TerminalFindDirection.Next, options }),
    [query, options, terminal],
  );
  const previous = useCallback(
    () =>
      terminal.current?.find?.search({ query, direction: TerminalFindDirection.Previous, options }),
    [query, options, terminal],
  );
  const measureWidget = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      terminal.current?.find?.setWidgetSize({ width, height });
    },
    [terminal],
  );
  const close = useCallback(() => {
    terminal.current?.find?.clear();
    setOpen(false);
    setOptions({});
    focusTerminal();
  }, [focusTerminal, terminal]);
  if (!open || !terminal.current?.find) return null;
  const total = `${result.resultCount}${result.limited ? "+" : ""}`;
  let status = "";
  if (result.invalid) status = t("paneFind.invalidRegex");
  else if (query) {
    if (result.resultCount === 0) status = t("paneFind.noMatches");
    else if (result.resultIndex < 0) status = t("paneFind.total", { total });
    else status = t("paneFind.position", { current: result.resultIndex + 1, total });
  }
  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, result.placement === "top" ? styles.top : styles.bottom]}
    >
      <View onLayout={measureWidget} style={styles.frame}>
        <PaneFind
          ref={widget}
          query={query}
          status={status}
          options={optionControls}
          invalid={result.invalid}
          canNavigate={!result.invalid && result.resultCount > 0}
          onQueryChange={search}
          onNext={next}
          onPrevious={previous}
          onClose={close}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "flex-end",
    zIndex: 2,
  },
  frame: { maxWidth: "100%", padding: theme.spacing[2] },
  top: { top: 0 },
  bottom: { bottom: 0 },
}));
