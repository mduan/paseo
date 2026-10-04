import fs from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

/**
 * Reads a file that a provider keeps appending to, one complete line at a time.
 * Each read parses only the bytes appended since the previous read, and reads run one at a time so
 * a line is never handed out twice.
 */
export class AppendedLinesReader {
  private offset = 0;
  private readonly decoder = new StringDecoder("utf8");
  private pendingLine = "";
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  /** Passes each line completed since the previous read to `onLine`. */
  read(onLine: (line: string) => void): Promise<void> {
    const result = this.queue.then(() => this.readAppended(onLine));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async readAppended(onLine: (line: string) => void): Promise<void> {
    const handle = await fs.open(this.filePath, "r");
    try {
      const { size } = await handle.stat();
      if (size <= this.offset) return;
      const buffer = Buffer.alloc(size - this.offset);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.offset);
      this.offset += bytesRead;
      const lines = (this.pendingLine + this.decoder.write(buffer.subarray(0, bytesRead))).split(
        "\n",
      );
      this.pendingLine = lines.pop() ?? "";
      for (const line of lines) {
        onLine(line);
      }
    } finally {
      await handle.close();
    }
  }
}

export function parseRecordLine(line: string): Record<string, unknown> | undefined {
  try {
    return toRecord(JSON.parse(line));
  } catch {
    // A torn or foreign line only drops that line from an estimate.
    return undefined;
  }
}

export function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
