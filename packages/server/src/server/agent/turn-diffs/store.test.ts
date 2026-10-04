import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { TurnDiffStore } from "./store.js";

const AGENT_ID = "agent-1";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("TurnDiffStore", () => {
  let root: string;
  let repo: string;
  let store: TurnDiffStore;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "turn-diffs-"));
    repo = path.join(root, "repo");
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    git(repo, "config", "user.email", "test@example.com");
    git(repo, "config", "user.name", "Test");
    writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "init");
    store = new TurnDiffStore(path.join(root, "turn-diffs"), createTestLogger());
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function runTurn(turnId: string, edit: () => void): Promise<void> {
    const start = await store.captureStart(repo);
    if (!start) throw new Error("expected a start snapshot");
    edit();
    await store.recordTurn({ agentId: AGENT_ID, start, turnId, userMessageIds: [`msg-${turnId}`] });
  }

  it("records the files a turn changed without touching the user's index", async () => {
    writeFileSync(path.join(repo, "staged.txt"), "staged\n");
    git(repo, "add", "staged.txt");
    const stagedBefore = git(repo, "diff", "--cached", "--name-only");

    await runTurn("t1", () => {
      writeFileSync(path.join(repo, "a.txt"), "one\nTWO\nthree\n");
      writeFileSync(path.join(repo, "new.txt"), "fresh\n");
    });

    expect(await store.list(AGENT_ID)).toEqual([
      {
        turnId: "t1",
        userMessageIds: ["msg-t1"],
        completedAt: expect.any(String),
        files: [
          { path: "a.txt", additions: 2, deletions: 1 },
          { path: "new.txt", additions: 1, deletions: 0 },
        ],
      },
    ]);
    expect(git(repo, "diff", "--cached", "--name-only")).toBe(stagedBefore);
    expect(git(repo, "status", "--porcelain", "--", "new.txt")).toBe("?? new.txt");
  });

  it("keeps the last turn even when it changed nothing", async () => {
    await runTurn("t1", () => writeFileSync(path.join(repo, "a.txt"), "changed\n"));
    await runTurn("t2", () => undefined);

    expect((await store.list(AGENT_ID)).map((turn) => turn.turnId)).toEqual(["t1"]);
    const lastTurn = await store.resolveRange(AGENT_ID, { kind: "last_turn" });
    expect(lastTurn?.fromTree).toBe(lastTurn?.toTree);
    expect(await store.resolveRange(AGENT_ID, { kind: "session" })).toBeNull();
    expect(await store.resolveRange(AGENT_ID, { kind: "turn", turnId: "t2" })).toBeNull();
  });

  async function changedFiles(turnId: string): Promise<string[] | undefined> {
    const turn = (await store.list(AGENT_ID)).find((candidate) => candidate.turnId === turnId);
    return turn?.files.map((file) => file.path);
  }

  it("leaves out content a checkout brought in but keeps edits and commits after it", async () => {
    git(repo, "checkout", "-q", "-b", "other");
    writeFileSync(path.join(repo, "other.txt"), "other\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "other");
    git(repo, "checkout", "-q", "main");
    writeFileSync(path.join(repo, "dirty.txt"), "dirty\n");

    await runTurn("t1", () => {
      git(repo, "checkout", "-q", "other");
      writeFileSync(path.join(repo, "committed.txt"), "committed\n");
      git(repo, "add", "committed.txt");
      git(repo, "commit", "-q", "-m", "agent");
      writeFileSync(path.join(repo, "a.txt"), "edited\n");
    });

    expect(await changedFiles("t1")).toEqual(["a.txt", "committed.txt"]);
  });

  it("keeps the agent's own commits when HEAD only moved by committing", async () => {
    await runTurn("t1", () => {
      writeFileSync(path.join(repo, "a.txt"), "edited\n");
      git(repo, "commit", "-q", "-am", "agent");
      git(repo, "commit", "-q", "--amend", "-m", "agent amended");
    });

    expect(await changedFiles("t1")).toEqual(["a.txt"]);
  });

  it("omits the turn when the start's uncommitted changes conflict with where HEAD landed", async () => {
    git(repo, "checkout", "-q", "-b", "other");
    writeFileSync(path.join(repo, "a.txt"), "other\n");
    git(repo, "commit", "-q", "-am", "other");
    git(repo, "checkout", "-q", "main");
    writeFileSync(path.join(repo, "a.txt"), "dirty\n");

    await runTurn("t1", () => {
      git(repo, "checkout", "-q", "-f", "other");
      writeFileSync(path.join(repo, "b.txt"), "new\n");
    });

    expect(await store.list(AGENT_ID)).toEqual([]);
    expect(await store.resolveRange(AGENT_ID, { kind: "last_turn" })).toBeNull();
  });

  it("keeps snapshot trees alive with hidden refs and removes them on delete", async () => {
    await runTurn("t1", () => writeFileSync(path.join(repo, "a.txt"), "changed\n"));

    const refs = git(
      repo,
      "for-each-ref",
      "--format=%(objecttype)",
      `refs/paseo/turns/${AGENT_ID}/`,
    );
    expect(refs.split("\n")).toEqual(["tree", "tree"]);
    expect(git(repo, "branch", "--list")).toBe("* main");

    await store.delete(AGENT_ID);
    expect(git(repo, "for-each-ref", `refs/paseo/turns/${AGENT_ID}/`)).toBe("");
    expect(existsSync(path.join(root, "turn-diffs", `${AGENT_ID}.json`))).toBe(false);
  });

  it("takes no snapshot outside a git repository", async () => {
    const plain = path.join(root, "plain");
    mkdirSync(plain);
    expect(await store.captureStart(plain)).toBeNull();
  });
});
