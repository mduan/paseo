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

interface GitOptions {
  cwd: string;
  env?: Record<string, string>;
  input?: string;
}

interface Repo {
  repoRoot: string;
  indexPath: string;
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
    const [repoRoot, indexPath] = (
      await git(["rev-parse", "--show-toplevel", "--git-path", "index"], { cwd })
    )
      .trim()
      .split("\n");
    return { repoRoot, indexPath: path.resolve(cwd, indexPath) };
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
    const tree = (await git(["write-tree"], { cwd: repo.repoRoot, env })).trim();
    return { repoRoot: repo.repoRoot, tree };
  } finally {
    await fs.rm(tempIndex, { force: true });
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
