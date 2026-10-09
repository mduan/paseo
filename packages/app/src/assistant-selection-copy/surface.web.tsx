import {
  useCallback,
  useMemo,
  useState,
  type ClipboardEvent,
  type MouseEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Copy } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  useContextMenu,
} from "@/components/ui/context-menu";
import { useToast } from "@/contexts/toast-api-context";
import type { Theme } from "@/styles/theme";
import { writeRichClipboardContent, type MarkdownClipboardContent } from "@/utils/rich-clipboard";
import { getDefaultMarkdownClipboardEnvironment } from "@/utils/rich-clipboard-default-environment";
import { createAssistantSelectionClipboardContent } from "./content.web";

interface AssistantSelectionCopySurfaceProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

const DISPLAY_CONTENTS: CSSProperties = { display: "contents" };
const ThemedCopy = withUnistyles(Copy);
const foregroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });

export function AssistantSelectionCopySurface(props: AssistantSelectionCopySurfaceProps) {
  return (
    <ContextMenu compactMode="popover">
      <AssistantCopySurface {...props} />
    </ContextMenu>
  );
}

function AssistantCopySurface({ children, style }: AssistantSelectionCopySurfaceProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { setOpen, setAnchorRect } = useContextMenu();
  const [clipboardContent, setClipboardContent] = useState<MarkdownClipboardContent>();
  const { mutate, reset, isPending, isError } = useMutation({
    mutationFn: (content: MarkdownClipboardContent) =>
      writeRichClipboardContent(content, getDefaultMarkdownClipboardEnvironment()),
    onSuccess: () => {
      toast.copied();
      setOpen(false);
    },
  });

  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('input, textarea, [contenteditable="true"]')) return;
      const message = event.target.closest('[data-testid="assistant-message"]');
      if (!message) return;

      event.preventDefault();
      event.stopPropagation();
      if (isPending) return;

      const content = createAssistantSelectionClipboardContent(window.getSelection());
      if (!content) {
        setOpen(false);
        return;
      }
      setClipboardContent(content);
      reset();
      setAnchorRect({ x: event.pageX, y: event.pageY, width: 0, height: 0 });
      setOpen(true);
    },
    [isPending, reset, setAnchorRect, setOpen],
  );

  const copySelection = useCallback(() => {
    if (clipboardContent) mutate(clipboardContent);
  }, [clipboardContent, mutate]);
  const copyIcon = useMemo(() => <ThemedCopy size={16} uniProps={foregroundMapping} />, []);

  const handleCopy = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const content = createAssistantSelectionClipboardContent(window.getSelection());
    if (!content) {
      return;
    }

    event.preventDefault();
    event.clipboardData.setData("text/plain", content.plainText);
    event.clipboardData.setData("text/html", content.html);
  }, []);

  return (
    <>
      <div onCopy={handleCopy} onContextMenu={handleContextMenu} style={DISPLAY_CONTENTS}>
        <View style={style}>{children}</View>
      </div>
      <ContextMenuContent align="start" minWidth={160} testID="assistant-copy-context-menu">
        <ContextMenuItem
          leading={copyIcon}
          disabled={!clipboardContent || isPending}
          status={isPending ? "pending" : "idle"}
          description={isError ? t("common.errors.unableToCopy") : undefined}
          closeOnSelect={false}
          onSelect={copySelection}
          testID="assistant-copy-context-menu-copy"
        >
          {t("common.actions.copy")}
        </ContextMenuItem>
      </ContextMenuContent>
    </>
  );
}
