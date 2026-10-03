import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { getGapBetweenStreamItems } from "./spacing";

function assistantBlock(params: {
  id: string;
  blockGroupId: string;
  blockIndex: number;
  text?: string;
}): Extract<StreamItem, { kind: "assistant_message" }> {
  return {
    kind: "assistant_message",
    id: params.id,
    blockGroupId: params.blockGroupId,
    blockIndex: params.blockIndex,
    text: params.text ?? "",
    timestamp: new Date("2026-05-01T00:00:00.000Z"),
  };
}

function toolCallBlock(id: string): Extract<StreamItem, { kind: "tool_call" }> {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date("2026-05-01T00:00:00.000Z"),
    payload: {
      source: "orchestrator",
      data: {
        toolCallId: id,
        toolName: "bash",
        arguments: "cmd",
        result: null,
        status: "executing",
      },
    },
  };
}

describe("getGapBetweenStreamItems", () => {
  it("spaces text between tool rows like the tool rows themselves", () => {
    const text = assistantBlock({ id: "a", blockGroupId: "g", blockIndex: 0 });
    const tool = toolCallBlock("t");
    const toolInset = 5;
    const paragraphMargin = 12;
    const betweenTools = toolInset + getGapBetweenStreamItems(tool, tool) + toolInset;
    expect(toolInset + getGapBetweenStreamItems(tool, text)).toBe(betweenTools);
    expect(paragraphMargin + getGapBetweenStreamItems(text, tool) + toolInset).toBe(betweenTools);
  });
});
