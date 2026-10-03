import type {
  CodexThreadForkParams,
  CodexThreadForkResponse,
  CodexThreadRollbackParams,
  CodexThreadRollbackResponse,
} from "./app-server-transport.js";
import {
  parseCodexThreadForkResponse,
  parseCodexThreadRollbackResponse,
} from "./app-server-transport.js";

export interface CodexRewindClient {
  forkThread?(params: CodexThreadForkParams): Promise<CodexThreadForkResponse>;
  rollbackThread?(params: CodexThreadRollbackParams): Promise<CodexThreadRollbackResponse>;
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
}

export interface CodexUserMessageTurnIndex {
  resolve(messageId: string): { index: number; turnId: string | null } | null;
  count(): number;
}

type CodexThreadHistoryMode = "legacy" | "paginated";

async function readCodexThreadHistoryMode(
  client: CodexRewindClient,
  threadId: string,
): Promise<CodexThreadHistoryMode> {
  const response = await client.request("thread/read", { threadId, includeTurns: false });
  if (typeof response !== "object" || response === null || !("thread" in response)) {
    throw new Error("Codex thread/read did not return thread metadata");
  }
  const thread = response.thread;
  if (typeof thread !== "object" || thread === null || !("historyMode" in thread)) {
    return "legacy";
  }
  if (thread.historyMode === "legacy" || thread.historyMode === "paginated") {
    return thread.historyMode;
  }
  throw new Error(`Codex thread/read returned unknown history mode ${String(thread.historyMode)}`);
}

async function forkCodexThread(
  client: CodexRewindClient,
  params: CodexThreadForkParams,
): Promise<CodexThreadForkResponse> {
  if (client.forkThread) {
    return client.forkThread(params);
  }
  return parseCodexThreadForkResponse(await client.request("thread/fork", params));
}

async function rollbackCodexThread(
  client: CodexRewindClient,
  params: CodexThreadRollbackParams,
): Promise<CodexThreadRollbackResponse> {
  if (client.rollbackThread) {
    return client.rollbackThread(params);
  }
  return parseCodexThreadRollbackResponse(await client.request("thread/rollback", params));
}

export async function revertCodexConversation(
  input: ForkCodexConversationInput & {
    messageId: string;
    setThreadId: (threadId: string) => void | Promise<void>;
  },
): Promise<void> {
  await input.setThreadId(await forkCodexConversation(input));
}

export interface ForkCodexConversationInput {
  client: CodexRewindClient;
  threadId: string | null;
  // The copy ends right before this user message. Without it, the whole thread is copied.
  messageId?: string;
  cwd?: string | null;
  model?: string | null;
  serviceTier?: string | null;
  config?: Record<string, unknown> | null;
  userMessageTurns: CodexUserMessageTurnIndex;
  threadRollbackAvailable: boolean;
}

/** Forks the thread into a new one and returns its id. The source thread is unchanged. */
export async function forkCodexConversation(input: ForkCodexConversationInput): Promise<string> {
  if (!input.threadId) {
    throw new Error("Codex thread is not ready for rewind");
  }

  // Codex does not carry the parent thread's config into a fork; without it the
  // forked thread falls back to the default model provider.
  const forkParams: CodexThreadForkParams = {
    threadId: input.threadId,
    cwd: input.cwd ?? null,
    model: input.model ?? null,
    serviceTier: input.serviceTier ?? null,
    ...(input.config ? { config: input.config } : {}),
    excludeTurns: false,
    persistExtendedHistory: true,
  };

  if (!input.messageId) {
    return (await forkCodexThread(input.client, forkParams)).thread.id;
  }

  const targetTurn = input.userMessageTurns.resolve(input.messageId);
  if (targetTurn === null) {
    throw new Error(`Codex could not find user message ${input.messageId} in the current thread`);
  }

  const currentUserTurnCount = input.userMessageTurns.count();
  const numTurns = currentUserTurnCount - targetTurn.index;
  if (numTurns < 0) {
    throw new Error(`Codex user message ${input.messageId} is outside the current thread`);
  }

  if (
    !input.threadRollbackAvailable ||
    (await readCodexThreadHistoryMode(input.client, input.threadId)) === "paginated"
  ) {
    if (!targetTurn.turnId) {
      throw new Error(`Codex could not find the turn containing user message ${input.messageId}`);
    }
    const forked = await forkCodexThread(input.client, {
      ...forkParams,
      beforeTurnId: targetTurn.turnId,
    });
    return forked.thread.id;
  }

  // Legacy threads on Codex before 0.156 fork and then roll back. Fork is
  // non-destructive: the old thread file stays on disk and remains
  // recoverable with `codex resume <old-uuid>` if the rewind target was wrong.
  const forked = await forkCodexThread(input.client, forkParams);
  const forkedThreadId = forked.thread.id;

  // Codex rollback is chat-only by design. File edits from rewound turns stay
  // on disk; a future file primitive would be a separate capability.
  const rolledBack = await rollbackCodexThread(input.client, {
    threadId: forkedThreadId,
    numTurns,
  });
  return rolledBack.thread.id;
}
