import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Finishes a `forkSession` copy for a new agent. The SDK always writes the fork
 * next to its source transcript and copies only the main conversation, so this
 * moves it into the target cwd's project dir the way the Claude CLI relocates a
 * session (move the file, then append a `relocated` record) and copies the
 * source's subagent and workflow transcripts alongside it.
 */
export async function placeClaudeForkTranscript(input: {
  sourceHistoryPath: string;
  forkSessionId: string;
  targetProjectDir: string;
  cwd: string;
}): Promise<void> {
  const sourceProjectDir = path.dirname(input.sourceHistoryPath);
  const forkFileName = `${input.forkSessionId}.jsonl`;
  const forkedPath = path.join(sourceProjectDir, forkFileName);
  const targetPath = path.join(input.targetProjectDir, forkFileName);

  await restoreLastForkedTimestamp({ forkedPath, sourceHistoryPath: input.sourceHistoryPath });

  if (forkedPath !== targetPath) {
    await fs.mkdir(input.targetProjectDir, { recursive: true });
    await fs.rename(forkedPath, targetPath);
    const relocated = {
      type: "relocated",
      sessionId: input.forkSessionId,
      relocatedCwd: input.cwd,
    };
    await fs.appendFile(targetPath, `${JSON.stringify(relocated)}\n`);
  }

  const sourceSessionDir = input.sourceHistoryPath.slice(0, -".jsonl".length);
  // ponytail: copies every subagent transcript, including ones from turns after the
  // fork point; their parent tool calls are not in the fork, so nothing renders them.
  await fs
    .cp(sourceSessionDir, path.join(input.targetProjectDir, input.forkSessionId), {
      recursive: true,
    })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
}

interface ClaudeTranscriptEntry {
  uuid?: string;
  timestamp?: string;
  forkedFrom?: { messageUuid?: string };
}

/**
 * `forkSession` stamps the last copied entry with the fork time, which stretches
 * the fork point's turn duration to "now". Put back the source entry's timestamp.
 */
async function restoreLastForkedTimestamp(input: {
  forkedPath: string;
  sourceHistoryPath: string;
}): Promise<void> {
  const lines = (await fs.readFile(input.forkedPath, "utf8")).split("\n");
  const index = lines.findLastIndex((line) => line.includes('"forkedFrom"'));
  if (index < 0) return;
  const entry = JSON.parse(lines[index]) as ClaudeTranscriptEntry;
  const sourceUuid = entry.forkedFrom?.messageUuid;
  if (!sourceUuid) return;
  const source = (await fs.readFile(input.sourceHistoryPath, "utf8"))
    .split("\n")
    .filter((line) => line.includes(sourceUuid))
    .map((line) => JSON.parse(line) as ClaudeTranscriptEntry)
    .find((candidate) => candidate.uuid === sourceUuid);
  if (!source?.timestamp) return;
  lines[index] = JSON.stringify({ ...entry, timestamp: source.timestamp });
  await fs.writeFile(input.forkedPath, lines.join("\n"));
}
