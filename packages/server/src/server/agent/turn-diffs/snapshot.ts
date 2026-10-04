import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { runGitCommand } from "../../../utils/run-git-command.js";
import type { TurnDiffFileStat } from "../../messages.js";

const MAX_UNTRACKED_FILE_BYTES = 1024 * 1024;
const REF_PREFIX = "refs/paseo/turns";

export interface WorkingTreeSnapshot {
  repoRoot: string;
  tree: string;
}

export type TurnStartSnapshot = WorkingTreeSnapshot & {
  // Undefined on an unborn branch.
  head?: string;
  headLogPath: string;
  headLogSize: number;
};

interface GitOptions {
  cwd: string;
  env?: Record<string, string>;
  input?: string;
}

interface Repo {
  repoRoot: string;
  indexPath: string;
  headLogPath: string;
}

async function git(args: string[], options: GitOptions): Promise<string> {
  const result = await runGitCommand(args, {
    cwd: options.cwd,
    ...(options.env ? { envOverlay: options.env } : {}),
    ...(options.input !== undefined ? { input: options.input } : {}),
  });
  return result.stdout;
}

async function resolveRepo(cwd: string): Promise<Repo | null> {
  try {
    const [repoRoot, indexPath, headLogPath] = (
      await git(
        ["rev-parse", "--show-toplevel", "--git-path", "index", "--git-path", "logs/HEAD"],
        { cwd },
      )
    )
      .trim()
      .split("\n");
    return {
      repoRoot,
      indexPath: path.resolve(cwd, indexPath),
      headLogPath: path.resolve(cwd, headLogPath),
    };
  } catch {
    // Not a git repository (or git is missing): turn diffs are git-only.
    return null;
  }
}

async function listSmallUntrackedFiles(repoRoot: string, env: Record<string, string>) {
  const output = await git(["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: repoRoot,
    env,
  });
  const paths = output.split("\0").filter(Boolean);
  const sizes = await Promise.all(
    paths.map((file) =>
      fs.stat(path.join(repoRoot, file)).then(
        (stat) => stat.size,
        () => Number.POSITIVE_INFINITY,
      ),
    ),
  );
  return paths.filter((_, index) => sizes[index] <= MAX_UNTRACKED_FILE_BYTES);
}

/**
 * Writes the whole working tree (tracked changes plus untracked, non-ignored files up to 1 MiB)
 * as a git tree object. Staging goes through a copy of the index, so the user's index, HEAD and
 * branches are untouched; only git objects are written.
 */
export async function snapshotWorkingTree(cwd: string): Promise<WorkingTreeSnapshot | null> {
  const repo = await resolveRepo(cwd);
  if (!repo) return null;
  return { repoRoot: repo.repoRoot, tree: await writeWorkingTree(repo) };
}

/** A working tree snapshot plus where HEAD and its reflog stood, to separate out branch moves. */
export async function snapshotTurnStart(cwd: string): Promise<TurnStartSnapshot | null> {
  const repo = await resolveRepo(cwd);
  if (!repo) return null;
  const headLogSize = await fs.stat(repo.headLogPath).then(
    (stat) => stat.size,
    () => 0,
  );
  const head = await readHead(repo.repoRoot);
  const tree = await writeWorkingTree(repo);
  return { repoRoot: repo.repoRoot, tree, head, headLogPath: repo.headLogPath, headLogSize };
}

async function writeWorkingTree(repo: Repo): Promise<string> {
  const tempIndex = path.join(os.tmpdir(), `paseo-turn-index-${randomUUID()}`);
  try {
    const stat = await fs.stat(repo.indexPath).catch(() => null);
    if (stat) {
      await fs.copyFile(repo.indexPath, tempIndex);
      // Keep the original mtime so git's racy-clean detection behaves as it does for the real index.
      await fs.utimes(tempIndex, stat.atime, stat.mtime);
    }
    const env = { GIT_INDEX_FILE: tempIndex };
    await git(["add", "-u", "--", "."], { cwd: repo.repoRoot, env });
    const untracked = await listSmallUntrackedFiles(repo.repoRoot, env);
    if (untracked.length > 0) {
      await git(["add", "--pathspec-from-file=-", "--pathspec-file-nul"], {
        cwd: repo.repoRoot,
        env,
        input: untracked.map((file) => `${file}\0`).join(""),
      });
    }
    return (await git(["write-tree"], { cwd: repo.repoRoot, env })).trim();
  } finally {
    await fs.rm(tempIndex, { force: true });
  }
}

async function readHead(repoRoot: string): Promise<string | undefined> {
  try {
    return (await git(["rev-parse", "--verify", "-q", "HEAD"], { cwd: repoRoot })).trim();
  } catch {
    return undefined;
  }
}

async function readFileFrom(filePath: string, offset: number): Promise<string | undefined> {
  const handle = await fs.open(filePath, "r").catch(() => null);
  if (!handle) return undefined;
  try {
    const { size } = await handle.stat();
    if (size < offset) return undefined;
    const buffer = Buffer.alloc(size - offset);
    await handle.read(buffer, 0, buffer.length, offset);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

const OWN_COMMIT_MESSAGE = /^commit( \((initial|amend)\))?: /;

/**
 * The commit HEAD landed on after the turn's last branch move (checkout, reset, pull, merge,
 * rebase, cherry-pick), read from the reflog lines the turn appended. Undefined when HEAD only
 * moved by the agent's own commits; null when the reflog can't tell.
 */
async function findLastBranchMove(start: TurnStartSnapshot): Promise<string | undefined | null> {
  const appended = await readFileFrom(start.headLogPath, start.headLogSize);
  if (appended === undefined) return null;
  let landing: string | undefined;
  for (const line of appended.split("\n")) {
    // <old> <new> <identity> <time> <tz>\t<message>
    const [header, message = ""] = line.split("\t", 2);
    const [oldHead, newHead] = header.split(" ");
    if (!newHead || oldHead === newHead || OWN_COMMIT_MESSAGE.test(message)) continue;
    landing = newHead;
  }
  return landing;
}

/**
 * The tree to diff a turn from. When the turn moved HEAD to another commit, the start snapshot's
 * uncommitted changes are replayed onto where HEAD landed, so the diff holds the agent's edits and
 * commits and none of the content the move brought in. Undefined when that can't be worked out
 * (no reflog, unborn branch, replay conflict); the turn then gets no diff.
 */
export async function resolveTurnFromTree(start: TurnStartSnapshot): Promise<string | undefined> {
  const head = await readHead(start.repoRoot);
  if (head === start.head) return start.tree;
  if (!head || !start.head) return undefined;
  const landing = await findLastBranchMove(start);
  if (landing === null) return undefined;
  if (landing === undefined || landing === start.head) return start.tree;
  try {
    const output = await git(
      ["merge-tree", "--write-tree", `--merge-base=${start.head}`, landing, start.tree],
      { cwd: start.repoRoot },
    );
    return output.split("\n")[0];
  } catch {
    // Exit code 1: the start's uncommitted changes conflict with where HEAD landed.
    return undefined;
  }
}

export async function diffTreeStats(params: {
  repoRoot: string;
  fromTree: string;
  toTree: string;
}): Promise<TurnDiffFileStat[]> {
  if (params.fromTree === params.toTree) return [];
  const output = await git(
    ["diff", "--numstat", "--no-renames", "-z", params.fromTree, params.toTree],
    { cwd: params.repoRoot },
  );
  const stats: TurnDiffFileStat[] = [];
  for (const entry of output.split("\0")) {
    const [additions, deletions, file] = entry.split("\t");
    if (file === undefined) continue;
    stats.push({
      path: file,
      additions: additions === "-" ? null : Number(additions),
      deletions: deletions === "-" ? null : Number(deletions),
    });
  }
  return stats;
}

function refName(agentId: string, tree: string): string {
  return `${REF_PREFIX}/${agentId}/${tree}`;
}

/**
 * Keeps exactly `trees` alive for this agent: one ref per tree under refs/paseo/turns/<agentId>/.
 * Refs that point at trees stay out of `git branch`, `git log --all` and normal pushes.
 */
export async function syncTreeRefs(params: {
  repoRoot: string;
  agentId: string;
  trees: ReadonlySet<string>;
}): Promise<void> {
  const existing = new Set(
    (
      await git(["for-each-ref", "--format=%(objectname)", `${REF_PREFIX}/${params.agentId}/`], {
        cwd: params.repoRoot,
      })
    )
      .split("\n")
      .filter(Boolean),
  );
  const commands: string[] = [];
  for (const tree of params.trees) {
    if (!existing.has(tree)) commands.push(`update ${refName(params.agentId, tree)} ${tree}`);
  }
  for (const tree of existing) {
    if (!params.trees.has(tree)) commands.push(`delete ${refName(params.agentId, tree)}`);
  }
  if (commands.length === 0) return;
  await git(["update-ref", "--stdin"], {
    cwd: params.repoRoot,
    input: `${commands.join("\n")}\n`,
  });
}
