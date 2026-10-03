import { promises as fs } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import { z } from "zod";

import { withTimeout } from "../../../utils/promise-timeout.js";
import { writeJsonFileAtomic } from "../../atomic-file.js";
import {
  TurnDiffFileStatSchema,
  type AgentTurnDiffTarget,
  type TurnDiffSummary,
} from "../../messages.js";
import {
  diffTreeStats,
  snapshotWorkingTree,
  syncTreeRefs,
  type WorkingTreeSnapshot,
} from "./snapshot.js";

// The prompt waits for the start snapshot; past this, the turn goes without a diff.
const START_SNAPSHOT_TIMEOUT_MS = 2_000;
const MAX_STORED_TURNS = 200;

const TreeRangeSchema = z.object({ fromTree: z.string(), toTree: z.string() });

const StoredTurnSchema = TreeRangeSchema.extend({
  turnId: z.string(),
  userMessageIds: z.array(z.string()),
  completedAt: z.string(),
  files: z.array(TurnDiffFileStatSchema),
});

const TurnDiffRecordSchema = z.object({
  repoRoot: z.string(),
  // First snapshot of the chat; "Chat Session" diffs from here. Never trimmed.
  sessionFromTree: z.string(),
  // Most recent finished turn, kept even when it changed nothing.
  lastTurn: TreeRangeSchema,
  // Turns that changed files, oldest first.
  turns: z.array(StoredTurnSchema),
});

type TurnDiffRecord = z.infer<typeof TurnDiffRecordSchema>;

export interface TurnDiffRange {
  repoRoot: string;
  fromTree: string;
  toTree: string;
}

export interface RecordTurnInput {
  agentId: string;
  start: WorkingTreeSnapshot;
  turnId: string;
  userMessageIds: string[];
}

function referencedTrees(record: TurnDiffRecord): Set<string> {
  const trees = new Set([record.sessionFromTree, record.lastTurn.fromTree, record.lastTurn.toTree]);
  for (const turn of record.turns) {
    trees.add(turn.fromTree);
    trees.add(turn.toTree);
  }
  return trees;
}

function toSummary(turn: z.infer<typeof StoredTurnSchema>): TurnDiffSummary {
  return {
    turnId: turn.turnId,
    userMessageIds: turn.userMessageIds,
    completedAt: turn.completedAt,
    files: turn.files,
  };
}

/**
 * Working-tree snapshots taken around each foreground turn, stored per agent in
 * `$PASEO_HOME/turn-diffs/<agentId>.json`. Snapshot trees are kept alive by git refs in the repo.
 */
export class TurnDiffStore {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly dir: string,
    private readonly logger: Logger,
  ) {}

  async captureStart(cwd: string): Promise<WorkingTreeSnapshot | null> {
    try {
      return await withTimeout({
        promise: snapshotWorkingTree(cwd),
        timeoutMs: START_SNAPSHOT_TIMEOUT_MS,
        label: "Turn start snapshot",
      });
    } catch (err) {
      this.logger.warn({ err, cwd }, "Turn start snapshot failed; this turn gets no diff");
      return null;
    }
  }

  recordTurn(input: RecordTurnInput): Promise<void> {
    return this.enqueue(input.agentId, () => this.applyTurn(input));
  }

  async list(agentId: string): Promise<TurnDiffSummary[]> {
    const record = await this.enqueue(agentId, () => this.read(agentId));
    return record ? record.turns.map(toSummary) : [];
  }

  async resolveRange(agentId: string, target: AgentTurnDiffTarget): Promise<TurnDiffRange | null> {
    const record = await this.enqueue(agentId, () => this.read(agentId));
    if (!record) return null;
    const { repoRoot } = record;
    switch (target.kind) {
      case "last_turn":
        return { repoRoot, ...record.lastTurn };
      case "session":
        return { repoRoot, fromTree: record.sessionFromTree, toTree: record.lastTurn.toTree };
      case "turn": {
        const turn = record.turns.find((candidate) => candidate.turnId === target.turnId);
        return turn ? { repoRoot, fromTree: turn.fromTree, toTree: turn.toTree } : null;
      }
    }
  }

  delete(agentId: string): Promise<void> {
    return this.enqueue(agentId, async () => {
      const record = await this.read(agentId);
      if (!record) return;
      await syncTreeRefs({ repoRoot: record.repoRoot, agentId, trees: new Set() }).catch((err) =>
        this.logger.warn({ err, agentId }, "Failed to delete turn diff refs"),
      );
      await fs.rm(this.filePath(agentId), { force: true });
    });
  }

  private async applyTurn({ agentId, start, turnId, userMessageIds }: RecordTurnInput) {
    const end = await snapshotWorkingTree(start.repoRoot);
    if (!end) return;
    const files = await diffTreeStats({
      repoRoot: start.repoRoot,
      fromTree: start.tree,
      toTree: end.tree,
    });
    const previous = await this.read(agentId);
    const isSameRepo = previous?.repoRoot === start.repoRoot;
    const record: TurnDiffRecord = {
      repoRoot: start.repoRoot,
      sessionFromTree: isSameRepo ? previous.sessionFromTree : start.tree,
      lastTurn: { fromTree: start.tree, toTree: end.tree },
      turns: isSameRepo ? previous.turns : [],
    };
    if (files.length > 0) {
      const completedAt = new Date().toISOString();
      const turn = {
        turnId,
        userMessageIds,
        completedAt,
        fromTree: start.tree,
        toTree: end.tree,
        files,
      };
      record.turns = [...record.turns, turn].slice(-MAX_STORED_TURNS);
    }
    await syncTreeRefs({ repoRoot: record.repoRoot, agentId, trees: referencedTrees(record) });
    await writeJsonFileAtomic(this.filePath(agentId), record);
  }

  private async read(agentId: string): Promise<TurnDiffRecord | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath(agentId), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    return TurnDiffRecordSchema.parse(JSON.parse(raw));
  }

  private filePath(agentId: string): string {
    return path.join(this.dir, `${agentId}.json`);
  }

  private enqueue<T>(agentId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(agentId) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.catch(() => undefined);
    this.queues.set(agentId, settled);
    void settled.then(() => {
      if (this.queues.get(agentId) === settled) this.queues.delete(agentId);
      return undefined;
    });
    return next;
  }
}
