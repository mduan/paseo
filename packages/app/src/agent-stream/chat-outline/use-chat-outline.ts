import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { AgentTimelinePromptIndexPayload } from "@getpaseo/client/internal/daemon-client";
import { isWeb } from "@/constants/platform";
import { useStableEvent } from "@/hooks/use-stable-event";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { planTimelinePromptJump } from "@/timeline/timeline-sync-plan";
import type { StreamItem } from "@/types/stream";
import type { StreamViewportHandle } from "../strategy";
import {
  createActivePromptPublisher,
  resolveActivePromptSeq,
  shouldAcceptPromptIndexEpoch,
  type ActivePromptSource,
  type ChatOutlinePrompt,
} from "./model";

const NO_PROMPTS: ChatOutlinePrompt[] = [];
const NO_STREAM_ITEMS: StreamItem[] = [];

interface PendingPromptJump {
  requestId: number;
  seq: number;
  fetchSettled: boolean;
  hasScrolled: boolean;
}

export interface UseChatOutlineInput {
  agentId: string;
  serverId: string;
  timelineEpoch: string | null;
  tail: StreamItem[];
  head: StreamItem[] | undefined;
  enabled: boolean;
  viewportRef: RefObject<StreamViewportHandle | null>;
  onJumpError: () => void;
  visibleMessageIds?: ReadonlySet<string>;
  revealLoadedMessage?: (messageId: string) => boolean;
}

export interface ChatOutline {
  prompts: ChatOutlinePrompt[];
  activePrompt: ActivePromptSource;
  jumpToPrompt: (seq: number) => void;
  reportReadingPosition: (seq: number | null) => void;
}

export function useChatOutline({
  agentId,
  serverId,
  timelineEpoch,
  tail,
  head,
  enabled,
  viewportRef,
  onJumpError,
  visibleMessageIds,
  revealLoadedMessage,
}: UseChatOutlineInput): ChatOutline {
  const [index, setIndex] = useState<AgentTimelinePromptIndexPayload | null>(null);
  const [pendingJump, setPendingJump] = useState<PendingPromptJump | null>(null);
  const [activePrompt] = useState(createActivePromptPublisher);
  const readingSeqRef = useRef<number | null>(null);
  const nextJumpRequestIdRef = useRef(0);
  const nextIndexRequestIdRef = useRef(0);
  const prompts = enabled ? (index?.prompts ?? NO_PROMPTS) : NO_PROMPTS;
  const indexable = isWeb && enabled && timelineEpoch !== null;

  // The viewed timeline already owns live delivery and reconnect catch-up. Its complete
  // loaded items (including rows outside the mounted window) invalidate the prompt index.
  // The head changes on every streamed chunk, so only it is rescanned; the tail scan is memoized.
  const tailPromptSeq = useMemo(
    () => (indexable ? findLatestPromptSeq(tail, timelineEpoch) : -1),
    [indexable, tail, timelineEpoch],
  );
  const latestPromptSeq = indexable
    ? Math.max(tailPromptSeq, findLatestPromptSeq(head ?? NO_STREAM_ITEMS, timelineEpoch))
    : -1;

  useEffect(() => setIndex(null), [agentId, enabled, serverId, timelineEpoch]);

  // Only a timeline the daemon has served can be indexed. A draft's optimistic stream has no
  // epoch, and its id names no agent the daemon knows.
  useEffect(() => {
    if (!isWeb || !enabled || timelineEpoch === null) {
      setIndex(null);
      return;
    }
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) return;
    let active = true;
    const refresh = () => {
      const requestId = ++nextIndexRequestIdRef.current;
      void client
        .listAgentTimelinePrompts(agentId)
        .then((payload) => {
          if (
            active &&
            requestId === nextIndexRequestIdRef.current &&
            shouldAcceptPromptIndexEpoch(timelineEpoch, payload.epoch)
          ) {
            setIndex(payload);
          }
          return undefined;
        })
        .catch(() => undefined);
    };
    refresh();
    return () => {
      active = false;
    };
  }, [agentId, enabled, serverId, timelineEpoch, latestPromptSeq]);

  // The transcript resolves display rows (including Markdown blocks and plugin cards) to
  // timeline positions. The outline uses the complete index, including unloaded prompts.
  const publishActivePrompt = useStableEvent(() => {
    activePrompt.publish(resolveActivePromptSeq(prompts, readingSeqRef.current));
  });

  const reportReadingPosition = useStableEvent((seq: number | null) => {
    readingSeqRef.current = seq;
    publishActivePrompt();
  });

  useEffect(() => {
    nextJumpRequestIdRef.current += 1;
    setPendingJump(null);
    readingSeqRef.current = null;
    activePrompt.publish(null);
  }, [activePrompt, agentId, timelineEpoch]);

  // The transcript reports its reading position long before the index arrives, and a reader
  // who never scrolls would otherwise sit on an unmarked rail.
  useEffect(() => {
    publishActivePrompt();
  }, [prompts, publishActivePrompt]);

  useEffect(() => {
    if (pendingJump === null) return;
    const target = findLoadedItemBySeq({ tail, head, seq: pendingJump.seq });
    if (target) {
      if (pendingJump.hasScrolled) return;
      if (visibleMessageIds?.has(target.id) === false) {
        revealLoadedMessage?.(target.id);
        return;
      }
      viewportRef.current?.scrollToMessage?.(target.id);
      setPendingJump((current) => {
        if (current?.requestId !== pendingJump.requestId) return current;
        return { ...current, hasScrolled: true };
      });
      return;
    }
    if (pendingJump.fetchSettled) setPendingJump(null);
  }, [head, pendingJump, revealLoadedMessage, tail, viewportRef, visibleMessageIds]);

  const jumpToPrompt = useCallback(
    (seq: number) => {
      nextJumpRequestIdRef.current += 1;
      setPendingJump(null);
      const loaded = findLoadedItemBySeq({ tail, head, seq });
      if (loaded) {
        if (revealLoadedMessage?.(loaded.id)) {
          const requestId = nextJumpRequestIdRef.current;
          setPendingJump({ requestId, seq, fetchSettled: true, hasScrolled: false });
          return;
        }
        viewportRef.current?.scrollToMessage?.(loaded.id);
        return;
      }
      if (!index) return;
      const requestId = nextJumpRequestIdRef.current;
      setPendingJump({ requestId, seq, fetchSettled: false, hasScrolled: false });
      void getHostRuntimeStore()
        .fetchAgentTimeline(serverId, agentId, planTimelinePromptJump({ epoch: index.epoch, seq }))
        .catch((error: unknown) => {
          console.warn("Failed to load a Chat outline window", error);
          onJumpError();
        })
        .finally(() => {
          setPendingJump((current) => {
            if (current?.requestId !== requestId) return current;
            return { ...current, fetchSettled: true };
          });
        });
    },
    [agentId, head, index, onJumpError, revealLoadedMessage, serverId, tail, viewportRef],
  );

  return { prompts, activePrompt, jumpToPrompt, reportReadingPosition };
}

function findLatestPromptSeq(items: StreamItem[], timelineEpoch: string | null): number {
  let latest = -1;
  for (const item of items) {
    if (item.kind === "user_message" && item.timelineCursor?.epoch === timelineEpoch) {
      latest = Math.max(latest, item.timelineCursor.seq);
    }
  }
  return latest;
}

function findLoadedItemBySeq({
  tail,
  head,
  seq,
}: {
  tail: StreamItem[];
  head: StreamItem[] | undefined;
  seq: number;
}): StreamItem | undefined {
  const matches = (item: StreamItem) => item.timelineCursor?.seq === seq;
  return tail.find(matches) ?? head?.find(matches);
}
