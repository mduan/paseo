import { shareCheckoutDiff } from "./diff-sharing";
import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckoutDiffHistoryStatus } from "@getpaseo/protocol/messages";
import { useTranslation } from "react-i18next";
import { useHostFeature } from "@/runtime/host-features";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useReplicaQuery } from "@/data/query";
import { checkoutDiffPushRoute } from "@/data/push-router";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { ParsedDiffFile, SubscribeCheckoutDiffResponse } from "@getpaseo/protocol/messages";
import { checkoutDiffQueryKey } from "@/git/query-keys";
import { usePendingCheckoutSwitch } from "@/git/pending-switch-store";

interface UseCheckoutDiffQueryOptions {
  serverId: string;
  cwd: string;
  mode: "uncommitted" | "base";
  includeUncommitted?: boolean;
  baseRef?: string;
  ignoreWhitespace?: boolean;
  enabled?: boolean;
  queryScope?: string;
}

type CheckoutDiffQueryPayload = Omit<SubscribeCheckoutDiffResponse["payload"], "subscriptionId">;

// Re-export the canonical protocol type so all consumers share one definition.
export type { ParsedDiffFile };
export type DiffHunk = ParsedDiffFile["hunks"][number];
export type DiffLine = DiffHunk["lines"][number];
export type HighlightToken = NonNullable<DiffLine["tokens"]>[number];

function normalizeCheckoutDiffCompare(compare: {
  mode: "uncommitted" | "base";
  includeUncommitted?: boolean;
  baseRef?: string;
  ignoreWhitespace?: boolean;
}): {
  mode: "uncommitted" | "base";
  baseRef?: string;
  ignoreWhitespace?: boolean;
  includeUncommitted?: boolean;
} {
  const ignoreWhitespace = compare.ignoreWhitespace === true;
  if (compare.mode === "uncommitted") {
    return { mode: "uncommitted", ignoreWhitespace };
  }
  const includeUncommitted = compare.includeUncommitted === true;
  const trimmedBaseRef = compare.baseRef?.trim();
  return trimmedBaseRef
    ? { mode: "base", baseRef: trimmedBaseRef, ignoreWhitespace, includeUncommitted }
    : { mode: "base", ignoreWhitespace, includeUncommitted };
}

export function useCheckoutDiffQuery({
  serverId,
  cwd,
  mode,
  includeUncommitted,
  baseRef,
  ignoreWhitespace,
  enabled = true,
  queryScope,
}: UseCheckoutDiffQueryOptions) {
  const retainedPanelActive = useRetainedPanelActive();
  const queryEnabled = enabled && retainedPanelActive;
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isSwitchingCheckout = usePendingCheckoutSwitch(serverId, cwd) !== undefined;
  const normalizedCompare = useMemo(
    () => normalizeCheckoutDiffCompare({ mode, baseRef, ignoreWhitespace, includeUncommitted }),
    [mode, baseRef, ignoreWhitespace, includeUncommitted],
  );
  const compareMode = normalizedCompare.mode;
  const compareIncludeUncommitted = normalizedCompare.includeUncommitted;
  const compareBaseRef = normalizedCompare.baseRef;
  const compareIgnoreWhitespace = normalizedCompare.ignoreWhitespace;
  const queryKey = useMemo(() => {
    const comparisonKey = checkoutDiffQueryKey(
      serverId,
      cwd,
      compareMode,
      compareBaseRef,
      compareIgnoreWhitespace,
      { includeUncommitted: compareIncludeUncommitted },
    );
    const normalizedScope = queryScope?.trim();
    return normalizedScope ? [...comparisonKey, "scope", normalizedScope] : comparisonKey;
  }, [
    serverId,
    cwd,
    compareMode,
    compareBaseRef,
    compareIgnoreWhitespace,
    compareIncludeUncommitted,
    queryScope,
  ]);
  const subscriptionId = useMemo(() => `checkoutDiff:${JSON.stringify(queryKey)}`, [queryKey]);
  const routeEnabled = Boolean(queryEnabled && isConnected && cwd);

  const query = useReplicaQuery<CheckoutDiffQueryPayload>({
    queryKey,
    structuralSharing: shareCheckoutDiff,
    enabled: routeEnabled,
    pushEvent: "checkout_diff_update",
    meta: checkoutDiffPushRoute({
      enabled: routeEnabled,
      serverId,
      subscriptionId,
      cwd,
      compare: {
        mode: compareMode,
        includeUncommitted: compareIncludeUncommitted,
        ...(compareBaseRef ? { baseRef: compareBaseRef } : {}),
        ignoreWhitespace: compareIgnoreWhitespace,
      },
    }),
  });

  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const historyRecoverySupported = useHostFeature(serverId, "checkoutHistoryRecovery");
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationKey: [...queryKey, "deepen-history"],
    mutationFn: async () => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      const payload = await client.deepenCheckoutHistory({ cwd, compare: normalizedCompare });
      return { payload, queryKey };
    },
    onSuccess: (result) => queryClient.setQueryData(result.queryKey, result.payload),
  });
  const derived = deriveCheckoutDiffResult(query.data ?? null);
  const result = {
    ...derived,
    isLoading: derived.isLoading || retry.isPending,
    historyStatus: retry.isPending ? CheckoutDiffHistoryStatus.Fetching : derived.historyStatus,
    payloadError:
      retry.error && derived.historyStatus === CheckoutDiffHistoryStatus.NeedsMoreHistory
        ? { code: "UNKNOWN" as const, message: retry.error.message }
        : derived.payloadError,
    retryHistory:
      historyRecoverySupported &&
      derived.historyStatus === CheckoutDiffHistoryStatus.NeedsMoreHistory
        ? () => retry.mutate()
        : undefined,
  };
  // While a switch runs, the diff on screen belongs to the checkout being left.
  return isSwitchingCheckout ? { ...result, isLoading: true } : result;
}

export interface CheckoutDiffResult {
  files: ParsedDiffFile[];
  historyStatus?: CheckoutDiffHistoryStatus;
  payloadError: CheckoutDiffQueryPayload["error"];
  diffTooLarge: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: null;
}

/**
 * The result derives from the payload alone. Until a payload arrives there is no
 * diff to describe, so the boundary reports loading rather than an empty diff —
 * whether the query is idle (an inactive retained panel), in flight, or the host
 * is disconnected. Reporting `files: []` as settled made callers render "+0 -0"
 * and "No changes" for a diff nobody has fetched yet.
 */
export function deriveCheckoutDiffResult(
  payload: CheckoutDiffQueryPayload | null,
): CheckoutDiffResult {
  const payloadError = payload?.error ?? null;
  return {
    files: payload?.files ?? [],
    historyStatus: payload?.historyStatus,
    payloadError,
    diffTooLarge: payload?.diffTooLarge === true,
    isLoading: payload === null || payload.historyStatus === CheckoutDiffHistoryStatus.Fetching,
    isFetching: false,
    isError: Boolean(payloadError),
    error: null,
  };
}
