import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { placeClaudeForkTranscript } from "./fork.js";

test("moves a fork into the target project dir, restores the fork point's timestamp, and copies subagent transcripts", async () => {
  const root = mkdtempSync(join(tmpdir(), "claude-fork-"));
  const sourceDir = join(root, "source-project");
  const targetDir = join(root, "worktree-project");
  mkdirSync(join(sourceDir, "source-session", "subagents"), { recursive: true });
  writeFileSync(
    join(sourceDir, "source-session.jsonl"),
    '{"type":"assistant","uuid":"a-1","timestamp":"2026-01-01T00:00:00.000Z"}\n',
  );
  writeFileSync(join(sourceDir, "source-session", "subagents", "agent-1.jsonl"), "{}\n");
  writeFileSync(
    join(sourceDir, "fork-session.jsonl"),
    '{"type":"assistant","uuid":"f-1","timestamp":"2026-01-01T00:09:00.000Z","forkedFrom":{"messageUuid":"a-1"}}\n',
  );

  await placeClaudeForkTranscript({
    sourceHistoryPath: join(sourceDir, "source-session.jsonl"),
    forkSessionId: "fork-session",
    targetProjectDir: targetDir,
    cwd: "/worktree",
  });

  expect(existsSync(join(sourceDir, "fork-session.jsonl"))).toBe(false);
  expect(readFileSync(join(targetDir, "fork-session.jsonl"), "utf8")).toBe(
    '{"type":"assistant","uuid":"f-1","timestamp":"2026-01-01T00:00:00.000Z","forkedFrom":{"messageUuid":"a-1"}}\n' +
      '{"type":"relocated","sessionId":"fork-session","relocatedCwd":"/worktree"}\n',
  );
  expect(existsSync(join(targetDir, "fork-session", "subagents", "agent-1.jsonl"))).toBe(true);
});
