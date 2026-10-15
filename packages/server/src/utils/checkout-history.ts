import { resolve } from "node:path";
import { LRUCache } from "lru-cache";
import { runGitCommand, type RunGitCommand } from "./run-git-command.js";

export class ShallowHistoryError extends Error {
  constructor(
    readonly comparison: { cwd: string; baseRef: string; commonDir: string; head: string },
  ) {
    super("Git couldn't find shared history. Fetch more history to compare this branch.");
    this.name = "ShallowHistoryError";
  }
}

export async function resolveCheckoutMergeBase(input: {
  cwd: string;
  baseRef: string;
}): Promise<string> {
  const { cwd, baseRef } = input;
  const result = await runGitCommand(["merge-base", baseRef, "HEAD"], {
    cwd,
    envOverlay: { GIT_OPTIONAL_LOCKS: "0" },
    acceptExitCodes: [0, 1],
  });
  if (result.exitCode === 0) return result.stdout.trim();
  const { stdout: shallow } = await runGitCommand(["rev-parse", "--is-shallow-repository"], {
    cwd,
  });
  if (shallow.trim() !== "true") {
    throw new Error(`git merge-base: HEAD and ${baseRef} have no common ancestor.`);
  }
  const [{ stdout }, { stdout: base }] = await Promise.all([
    runGitCommand(["rev-parse", "--git-common-dir", "HEAD"], { cwd }),
    runGitCommand(["rev-parse", "--symbolic-full-name", baseRef], { cwd }),
  ]);
  const [commonDir, head] = stdout.trim().split("\n");
  if (!commonDir || !head) throw new Error("Cannot resolve shallow checkout history.");
  throw new ShallowHistoryError({
    cwd,
    baseRef: base.trim(),
    commonDir: resolve(cwd, commonDir),
    head,
  });
}

export class CheckoutHistoryRecovery {
  private readonly attempts = new LRUCache<string, Error | true>({ max: 256 });
  private readonly active = new Map<string, Promise<void>>();

  constructor(private readonly run: RunGitCommand = runGitCommand) {}

  recover(input: {
    history: ShallowHistoryError;
    retry?: boolean;
  }): { promise: Promise<void>; started: boolean } | undefined {
    const { history, retry = false } = input;
    const { commonDir, baseRef, head } = history.comparison;
    const key = JSON.stringify([commonDir, baseRef, head]);
    const pending = this.active.get(commonDir);
    if (pending) {
      return { promise: pending, started: false };
    }
    if (!retry && this.attempts.has(key)) return;
    this.attempts.set(key, true);
    const promise = this.fetch(history)
      .catch((caught: unknown) => {
        this.attempts.set(key, caught instanceof Error ? caught : new Error(String(caught)));
      })
      .finally(() => this.active.delete(commonDir));
    this.active.set(commonDir, promise);
    return { promise, started: true };
  }

  failure(history: ShallowHistoryError): Error | undefined {
    const { commonDir, baseRef, head } = history.comparison;
    const attempt = this.attempts.get(JSON.stringify([commonDir, baseRef, head]));
    return attempt instanceof Error ? attempt : undefined;
  }

  private async fetch(history: ShallowHistoryError): Promise<void> {
    const { cwd, baseRef } = history.comparison;
    const [{ stdout: head }, { stdout: remoteOutput }, { stdout: trackingHeads }] =
      await Promise.all([
        this.run(["symbolic-ref", "--quiet", "HEAD"], { cwd, acceptExitCodes: [0, 1] }),
        this.run(["remote"], { cwd }),
        this.run(
          [
            "for-each-ref",
            `--points-at=${history.comparison.head}`,
            "--format=%(refname)",
            "refs/remotes",
          ],
          { cwd },
        ),
      ]);
    const remotes = remoteOutput
      .trim()
      .split("\n")
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    const targets = new Map<string, Set<string>>();
    const trackingHead = trackingHeads.split("\n").find((ref) => ref && !ref.endsWith("/HEAD"));
    for (const ref of new Set([baseRef, head.trim(), trackingHead])) {
      if (!ref) continue;
      let remote = remotes.find((name) => ref.startsWith(`refs/remotes/${name}/`));
      let branch: string | undefined = remote
        ? `refs/heads/${ref.slice(`refs/remotes/${remote}/`.length)}`
        : undefined;
      if (ref.startsWith("refs/heads/")) {
        const { stdout } = await this.run(
          ["for-each-ref", "--format=%(upstream:remotename)%00%(upstream:remoteref)", ref],
          { cwd },
        );
        [remote, branch] = stdout.trim().split("\0");
      }
      if (!remote || remote === "." || !branch) continue;
      const branches = targets.get(remote) ?? new Set<string>();
      branches.add(branch);
      targets.set(remote, branches);
    }
    if (!targets.size) {
      throw new Error("No remote tracking branch is configured. Fetch more history in a terminal.");
    }
    for (const [remote, branches] of targets) {
      await this.run(["fetch", "--deepen=500", "--no-tags", "--", remote, ...branches], {
        cwd,
        envOverlay: { GIT_TERMINAL_PROMPT: "0" },
        timeout: 120_000,
      });
    }
  }
}
