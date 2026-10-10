import { useCallback, useMemo, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { ArrowUp, GripVertical, Pencil } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { DraggableList } from "@/components/draggable-list";
import type { DraggableRenderItemInfo } from "@/components/draggable-list.types";
import { isNative, isWeb } from "@/constants/platform";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { QueuedComposerMessage } from "./actions";

type QueuedMessageListProps = Readonly<{
  queuedMessages: readonly QueuedComposerMessage[];
  onEdit: (id: string) => void;
  onReorder: (messages: QueuedComposerMessage[]) => void;
  onSendNow: (id: string) => void;
  editLabel: string;
  reorderLabel: string;
  sendNowLabel: string;
}>;

function messageKey(item: QueuedComposerMessage): string {
  return item.id;
}

export function QueuedMessageList({
  queuedMessages,
  onEdit,
  onReorder,
  onSendNow,
  editLabel,
  reorderLabel,
  sendNowLabel,
}: QueuedMessageListProps) {
  const currentQueueRef = useRef(queuedMessages);
  currentQueueRef.current = queuedMessages;
  const handleDragEnd = useCallback(
    (messages: QueuedComposerMessage[]) => {
      // dnd-kit mouse sensors can deliver a drop after their context unmounts.
      if (currentQueueRef.current !== queuedMessages) return;
      onReorder(messages);
    },
    [onReorder, queuedMessages],
  );
  const data = useMemo(() => [...queuedMessages], [queuedMessages]);
  const renderItem = useCallback(
    ({ item, drag, dragHandleProps }: DraggableRenderItemInfo<QueuedComposerMessage>) => (
      <QueuedMessageRow
        item={item}
        drag={drag}
        dragHandleProps={dragHandleProps}
        onEdit={onEdit}
        onSendNow={onSendNow}
        editLabel={editLabel}
        reorderLabel={reorderLabel}
        sendNowLabel={sendNowLabel}
      />
    ),
    [editLabel, onEdit, onSendNow, reorderLabel, sendNowLabel],
  );

  if (!queuedMessages.length) return null;
  // Reset the drag UI when queue membership or order changes.
  const queueKey = JSON.stringify(queuedMessages.map(messageKey));
  return (
    <DraggableList
      key={queueKey}
      data={data}
      keyExtractor={messageKey}
      renderItem={renderItem}
      onDragEnd={handleDragEnd}
      containerStyle={styles.queueTrack}
      contentContainerStyle={styles.queueTrack}
      scrollEnabled={false}
      useDragHandle
    />
  );
}

// React Native web Pressable swallows the Space key needed to finish a keyboard drag.
const DragHandle = isWeb ? View : Pressable;

type QueuedMessageRowProps = Omit<QueuedMessageListProps, "queuedMessages" | "onReorder"> &
  Pick<DraggableRenderItemInfo<QueuedComposerMessage>, "item" | "drag" | "dragHandleProps">;

function QueuedMessageRow({
  item,
  drag,
  dragHandleProps,
  onEdit,
  onSendNow,
  editLabel,
  reorderLabel,
  sendNowLabel,
}: QueuedMessageRowProps) {
  const handleEdit = useCallback(() => onEdit(item.id), [onEdit, item.id]);
  const handleSendNow = useCallback(() => onSendNow(item.id), [onSendNow, item.id]);
  const setDragHandleRef = useCallback(
    (node: unknown) => {
      dragHandleProps?.setActivatorNodeRef?.(node);
      if (isWeb && node instanceof HTMLElement) {
        node.style.cursor = "grab";
        node.style.touchAction = "none";
      }
    },
    [dragHandleProps],
  );
  return (
    <View style={styles.queueItem}>
      <DragHandle
        {...dragHandleProps?.attributes}
        {...dragHandleProps?.listeners}
        ref={setDragHandleRef}
        onLongPress={isNative ? drag : undefined}
        style={styles.dragHandle}
        accessibilityLabel={reorderLabel}
        accessibilityRole="button"
      >
        <ThemedGripVertical size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />
      </DragHandle>
      <Text style={styles.queueText} numberOfLines={2} ellipsizeMode="tail">
        {item.text}
      </Text>
      <View style={styles.queueActions}>
        <Pressable
          onPress={handleEdit}
          style={styles.queueActionButton}
          accessibilityLabel={editLabel}
          accessibilityRole="button"
        >
          <ThemedPencil size={ICON_SIZE.sm} uniProps={iconForegroundMapping} />
        </Pressable>
        <Pressable
          onPress={handleSendNow}
          style={[styles.queueActionButton, styles.queueSendButton]}
          accessibilityLabel={sendNowLabel}
          accessibilityRole="button"
        >
          <ThemedArrowUp size={ICON_SIZE.sm} uniProps={iconAccentForegroundMapping} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  queueTrack: {
    flexDirection: "column",
    gap: theme.spacing[2],
  },
  queueItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    gap: theme.spacing[2],
  },
  dragHandle: {
    width: isNative ? 44 : 24,
    height: isNative ? 44 : 32,
    alignItems: "center",
    justifyContent: "center",
  },
  queueText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  queueActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  queueActionButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  queueSendButton: {
    backgroundColor: theme.colors.accent,
  },
}));

const ThemedPencil = withUnistyles(Pencil);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedGripVertical = withUnistyles(GripVertical);
const iconForegroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const iconAccentForegroundMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
