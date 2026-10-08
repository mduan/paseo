import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Text, type GestureResponderEvent, type StyleProp, type TextStyle } from "react-native";
import { isWeb } from "@/constants/platform";
import { useStableEvent } from "@/hooks/use-stable-event";
import { markdownLinkTextStyle } from "./link-children";
import { openExternalUrl } from "@/utils/open-external-url";

type MarkdownLinkTextProps = {
  style: StyleProp<TextStyle>;
  dataSet?: Record<string, string>;
  onHoverIn?(): void;
  children?: ReactNode;
} & ({ href: string; onPress?: never } | { href?: never; onPress(): void });

export function MarkdownLinkText({
  style,
  dataSet,
  href,
  onPress,
  onHoverIn,
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
      accessibilityRole="link"
      dataSet={dataSet}
      style={textStyle}
      onPress={handlePress}
      {...(isWeb
        ? {
            href,
            onMouseEnter: handleHoverIn,
            onMouseLeave: handleHoverOut,
            onKeyDown: handleKeyDown,
          }
        : {})}
    >
      {children}
    </Text>
  );
}
