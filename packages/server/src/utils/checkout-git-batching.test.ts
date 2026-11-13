import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { startGitCommandMetrics, stopGitCommandMetrics } from "@server/utils/run-git-command.js";

import { getCheckoutDiff } from "./checkout-git.js";

function initRepoWithTrackedChanges(fileCount: number): { tempDir: string; repoDir: string } {
  const tempDir = realpathSync(mkdtempSync(join(tmpdir(), "checkout-git-batch-test-")));
  const repoDir = join(tempDir, "repo");

  mkdirSync(repoDir, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });

  for (let i = 0; i < fileCount; i += 1) {
    writeFileSync(join(repoDir, `file-${i}.txt`), `before-${i}\n`);
  }
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "initial"], {
    cwd: repoDir,
  });

  for (let i = 0; i < fileCount; i += 1) {
    writeFileSync(join(repoDir, `file-${i}.txt`), `after-${i}\n`);
  }

  return { tempDir, repoDir };
}

describe("checkout git diff batching", () => {
  let tempDir: string;
  let repoDir: string;

  beforeEach(() => {
    const setup = initRepoWithTrackedChanges(20);
    tempDir = setup.tempDir;
    repoDir = setup.repoDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("collects ordinary tracked patches with one bounded Git command", async () => {
    startGitCommandMetrics();
    const result = await getCheckoutDiff(repoDir, {
      mode: "uncommitted",
      includeStructured: false,
    });

    expect(result.diff).toContain("file-0.txt");
    expect(result.diff).toContain("file-19.txt");
    const metrics = stopGitCommandMetrics();
    expect(
      metrics.commands.filter(({ args }) => args[0] === "diff" && args.includes("--")),
    ).toHaveLength(1);
  });

  it("batches committed file contents and preserves the highlighted diff", async () => {
    execFileSync("git", ["checkout", "-b", "feature"], { cwd: repoDir });
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "change"], { cwd: repoDir });
    startGitCommandMetrics();
    const result = await getCheckoutDiff(repoDir, {
      mode: "base",
      baseRef: "main",
      includeStructured: true,
    });
    const metrics = stopGitCommandMetrics();
    expect(result.structured).toHaveLength(20);
    expect(result.structured?.every((file) => file.additions === 1 && file.deletions === 1)).toBe(
      true,
    );
    expect(metrics.commands.filter(({ args }) => args[0] === "show")).toHaveLength(0);
    expect(metrics.commands.filter(({ args }) => args[0] === "cat-file")).toHaveLength(1);
  });

  it("keeps small neighbors when a patch exceeds the entire batch budget", async () => {
    writeFileSync(join(repoDir, "file-0.txt"), "x".repeat(9 * 1024 * 1024) + "\n");
    const result = await getCheckoutDiff(repoDir, {
      mode: "uncommitted",
      includeStructured: true,
    });
    expect(result.structured).toHaveLength(20);
    expect(result.structured?.find((file) => file.path === "file-0.txt")).toMatchObject({
      status: "too_large",
      hunks: [],
    });
    expect(result.structured?.filter((file) => file.status === "ok")).toHaveLength(19);
    expect(result.diff).toContain("+after-19");
    expect(result.diff).not.toContain("x".repeat(1_000));
  });

  it("keeps large file contents batched when their combined size exceeds the read budget", async () => {
    const padding = '  "unchanged": 0,\n'.repeat(150_000);
    const paths = Array.from({ length: 5 }, (_, index) => `large-${index}.json`);
    for (const path of paths) {
      writeFileSync(join(repoDir, path), `{\n  "version": 1,\n${padding}  "end": true\n}\n`);
    }
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "large files"], {
      cwd: repoDir,
    });
    execFileSync("git", ["checkout", "-b", "feature"], { cwd: repoDir });
    for (const path of paths) {
      writeFileSync(join(repoDir, path), `{\n  "version": 2,\n${padding}  "end": true\n}\n`);
    }
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "edit large files"], {
      cwd: repoDir,
    });
    startGitCommandMetrics();
    const result = await getCheckoutDiff(repoDir, {
      mode: "base",
      baseRef: "main",
      includeStructured: true,
    });
    const metrics = stopGitCommandMetrics();

    expect(
      result.structured?.map((file) => ({
        path: file.path,
        additions: file.additions,
        deletions: file.deletions,
        lineCount: file.lineCount,
      })),
    ).toEqual(paths.map((path) => ({ path, additions: 1, deletions: 1, lineCount: 150_004 })));
    expect(metrics.commands.filter(({ args }) => args[0] === "show")).toHaveLength(0);
    expect(metrics.commands.filter(({ args }) => args[0] === "cat-file")).toHaveLength(3);
  });
});
