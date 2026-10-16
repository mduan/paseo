import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Text, type GestureResponderEvent, type StyleProp, type TextStyle } from "react-native";
import { isNative, isWeb } from "@/constants/platform";
import { useStableEvent } from "@/hooks/use-stable-event";
import { markdownLinkTextStyle } from "./link-children";
import { openExternalUrl } from "@/utils/open-external-url";

type MarkdownLinkTextProps = {
  style: StyleProp<TextStyle>;
  dataSet?: Record<string, string>;
  onHoverIn?(): void;
  selectable?: boolean;
  onBlur?(): void;
  children?: ReactNode;
} & ({ href: string; onPress?: never } | { href?: never; onPress(): void });

// Native Pressability otherwise activates the link when text selection releases a long press.
function handleNativeLongPress() {}

export function MarkdownLinkText({
  style,
  dataSet,
  href,
  onPress,
  onHoverIn,
  selectable,
  onBlur,
  children,
}: MarkdownLinkTextProps) {
  const [hovered, setHovered] = useState(false);
  const handleHoverIn = useStableEvent(() => {
    setHovered(true);
    onHoverIn?.();
  });
  const handleHoverOut = useStableEvent(() => setHovered(false));
  const activate = useStableEvent(() => {
    if (onPress) {
      onPress();
      return;
    }
    void openExternalUrl(href).catch(console.error);
  });
  const handlePress = useStableEvent((event: GestureResponderEvent) => {
    event.preventDefault();
    activate();
  });
  const handleKeyDown = useStableEvent((event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    activate();
  });
  const textStyle = useMemo(() => markdownLinkTextStyle(style, hovered), [hovered, style]);

  return (
    <Text
      selectable={selectable}
      accessibilityRole="link"
      dataSet={dataSet}
      style={textStyle}
      onPress={handlePress}
      onLongPress={isNative ? handleNativeLongPress : undefined}
      {...(isWeb
        ? {
            href,
            onMouseEnter: handleHoverIn,
            onMouseLeave: handleHoverOut,
            onKeyDown: handleKeyDown,
            onBlur,
          }
        : {})}
    >
      {children}
    </Text>
  );
}
