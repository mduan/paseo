import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { AgentTimelineItem } from "../../agent-sdk-types.js";
import { ClaudeAgentClient } from "./agent.js";
import { claudeProjectDirSync } from "./project-dir.js";

/**
 * A resumed Claude agent whose transcript is missing or unreadable opens with an empty timeline.
 * The daemon log at its default level has to say which, and where it looked.
 */

const SESSION_ID = "history-load-session";

interface LogRecord {
  level: number;
  msg: string;
  sessionId?: string;
  historyPath?: string;
  err?: { message?: string };
}

describe("ClaudeAgentSession persisted history load", () => {
  let tempRoot: string;
  let cwd: string;
  let configDir: string;
  let records: LogRecord[];

  async function resume(): Promise<void> {
    const session = await resumeSession();
    await session.close();
  }

  async function resumeSession() {
    const client = new ClaudeAgentClient({
      logger: pino({ level: "info" }, { write: (line: string) => records.push(JSON.parse(line)) }),
      queryFactory: vi.fn(() => {
        throw new Error("history load must not start a query");
      }),
      resolveVersion: async () => "2.1.220",
    });
    return client.resumeSession({ provider: "claude", sessionId: SESSION_ID }, { cwd });
  }

  function transcriptPath(): string {
    return path.join(claudeProjectDirSync(cwd, { configDir }), `${SESSION_ID}.jsonl`);
  }

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), "claude-history-load-"));
    cwd = path.join(tempRoot, "repo");
    configDir = path.join(tempRoot, "claude-config");
    mkdirSync(cwd, { recursive: true });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    records = [];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("logs the resolved transcript path when the transcript does not exist", async () => {
    await resume();

    expect(records).toContainEqual(
      expect.objectContaining({
        level: pino.levels.values.info,
        msg: "No Claude transcript to load history from",
        sessionId: SESSION_ID,
        historyPath: transcriptPath(),
      }),
    );
  });

  test("logs a warning with the error when the transcript cannot be read", async () => {
    // A directory at the transcript path exists but cannot be read as a file.
    mkdirSync(transcriptPath(), { recursive: true });

    await resume();

    expect(records).toContainEqual(
      expect.objectContaining({
        level: pino.levels.values.warn,
        msg: "Failed to load Claude history from transcript",
        sessionId: SESSION_ID,
        historyPath: transcriptPath(),
        err: expect.objectContaining({ message: expect.stringContaining("EISDIR") }),
      }),
    );
  });

  test("skips API request copies that Claude Code records in the transcript", async () => {
    // Claude Code 2.1.2xx writes each API request body as `api-request-blob` entries. Their
    // messages hold injected context (deferred-tool notices, MCP instructions, reminders).
    const transcript = [
      { type: "user", uuid: "u1", message: { role: "user", content: "Write util.ts" } },
      {
        type: "api-request-blob",
        hash: "h1",
        message: {
          role: "system",
          content: [
            { type: "text", text: "The following tools just became available" },
            { type: "tool_addition", name: "mcp__docs__read" },
          ],
        },
      },
      {
        type: "api-request-blob",
        hash: "h2",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "ok" },
            { type: "text", text: "<system-reminder>MCP server instructions</system-reminder>" },
          ],
        },
      },
      {
        type: "assistant",
        uuid: "a1",
        message: { id: "msg_1", role: "assistant", content: [{ type: "text", text: "Done." }] },
      },
    ];
    mkdirSync(path.dirname(transcriptPath()), { recursive: true });
    writeFileSync(transcriptPath(), transcript.map((entry) => JSON.stringify(entry)).join("\n"));

    const session = await resumeSession();
    const items: AgentTimelineItem[] = [];
    try {
      for await (const event of session.streamHistory()) {
        if (event.type === "timeline") items.push(event.item);
      }
    } finally {
      await session.close();
    }

    expect(items.map((item) => item.type)).toEqual(["user_message", "assistant_message"]);
    expect(items[1]).toMatchObject({ type: "assistant_message", text: "Done." });
  });
});
