import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, useWindowDimensions, type ViewProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AttachmentPillContent } from "@/attachments/attachment-pill-content";
import { AttachmentFrame, AttachmentLabel, AttachmentPill } from "@/components/attachment-pill";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { MarkdownLinkText } from "@/components/markdown/link-text";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { isHttpUrl } from "@/utils/http-url";
import { OVERLAY_Z, useWebOverlayRegistration } from "@/lib/overlay-root";

enum LinkPreviewState {
  Closed,
  Hovered,
  Focused,
}

type LinkAttachmentPillProps = Readonly<{
  url: string;
  content: AttachmentPillContent;
  accessibilityLabel?: string;
  disabled?: boolean;
  testID?: string;
}> &
  (
    | Readonly<{ onRemove: () => void; removeAccessibilityLabel: string }>
    | Readonly<{ onRemove?: undefined; removeAccessibilityLabel?: undefined }>
  );

export function LinkAttachmentPill(props: LinkAttachmentPillProps) {
  const { url, content, disabled, testID, accessibilityLabel = content.title } = props;
  const active = useRetainedPanelActive();
  const compact = useIsCompactFormFactor();
  const { width } = useWindowDimensions();
  const [preview, setPreview] = useState(LinkPreviewState.Closed);
  const popupRef = useRef<HTMLElement | undefined>(undefined);
  const restoringFocus = useRef(false);
  const open = preview !== LinkPreviewState.Closed;
  const hasUrl = isHttpUrl(url);
  const enabled = active && !disabled && hasUrl;
  const useSheet = isNative || compact;
  const show = useCallback(() => {
    if (enabled) setPreview(LinkPreviewState.Focused);
  }, [enabled]);
  const close = useCallback(() => {
    restoringFocus.current = true;
    setPreview(LinkPreviewState.Closed);
  }, []);
  const onHoverChange = useCallback((nextOpen: boolean) => {
    setPreview((current) => {
      if (current === LinkPreviewState.Focused) return current;
      return nextOpen ? LinkPreviewState.Hovered : LinkPreviewState.Closed;
    });
  }, []);
  const focusLink = useCallback(() => {
    if (!isWeb || useSheet || preview !== LinkPreviewState.Focused) return;
    popupRef.current?.querySelector<HTMLElement>("a[href]")?.focus({ preventScroll: true });
  }, [preview, useSheet]);
  const onTriggerBlur = useCallback<NonNullable<ViewProps["onBlur"]>>((event) => {
    const nextTarget = "relatedTarget" in event ? event.relatedTarget : undefined;
    if (isWeb && nextTarget instanceof Node && popupRef.current?.contains(nextTarget)) {
      event.stopPropagation();
    }
  }, []);
  const onTriggerFocus = useCallback<NonNullable<ViewProps["onFocus"]>>((event) => {
    if (!restoringFocus.current) return;
    restoringFocus.current = false;
    event.stopPropagation();
  }, []);
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== "Escape") return false;
      event.preventDefault();
      event.stopPropagation();
      close();
      return true;
    },
    [close],
  );
  const setPopupScope = useWebOverlayRegistration({
    active: isWeb && !useSheet && preview === LinkPreviewState.Focused,
    layer: OVERLAY_Z.tooltip,
    onKeyDown,
  });
  const setPopupRef = useCallback(
    (node: unknown) => {
      setPopupScope(node);
      if (!isWeb) return;
      popupRef.current = node instanceof HTMLElement ? node : undefined;
      focusLink();
    },
    [focusLink, setPopupScope],
  );
  useEffect(focusLink, [focusLink]);
  const header = useMemo(() => ({ title: content.title }), [content.title]);

  useEffect(() => {
    if (!enabled) close();
  }, [enabled, close]);

  const label = (
    <AttachmentLabel icon={content.icon} title={content.title} subtitle={content.subtitle} />
  );
  const pill = props.onRemove ? (
    <AttachmentPill
      onOpen={show}
      onRemove={props.onRemove}
      openAccessibilityLabel={accessibilityLabel}
      removeAccessibilityLabel={props.removeAccessibilityLabel}
      disabled={disabled}
      testID={testID}
    >
      {label}
    </AttachmentPill>
  ) : (
    <AttachmentFrame onPress={show} accessibilityLabel={accessibilityLabel} testID={testID}>
      {label}
    </AttachmentFrame>
  );
  const link = hasUrl ? (
    <MarkdownLinkText href={url} style={styles.url} selectable onBlur={close}>
      {url}
    </MarkdownLinkText>
  ) : null;
  // The URL is portaled; moving focus to it must not blur-close the trigger.
  const trigger = (
    <View style={styles.trigger}>
      <View {...(isWeb ? { onBlur: onTriggerBlur, onFocus: onTriggerFocus } : {})}>{pill}</View>
    </View>
  );

  if (useSheet) {
    return (
      <>
        {trigger}
        <AdaptiveModalSheet visible={open && enabled} onClose={close} header={header}>
          {link}
        </AdaptiveModalSheet>
      </>
    );
  }
  return (
    <Tooltip
      open={open && enabled}
      onOpenChange={onHoverChange}
      enabledOnDesktop={enabled}
      interactive
    >
      <TooltipTrigger asChild disabled={disabled}>
        {trigger}
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        maxWidth={Math.min(480, width - 16)}
        style={styles.popup}
        testID="attachment-link-popup"
      >
        <View ref={setPopupRef} onLayout={focusLink}>
          {link}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: { maxWidth: "100%" },
  popup: { padding: theme.spacing[3] },
  url: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    flexShrink: 1,
    ...(isWeb ? { overflowWrap: "anywhere" as const } : {}),
  },
}));
