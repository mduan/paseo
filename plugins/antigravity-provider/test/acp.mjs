import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
let sessionId;
let model = "gemini-3.8-flash-low";
let mode = "default";
let pendingPrompt;
function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}
function options() {
  const selectedModel = process.env.AGY_TEST_NORMALIZE_MODEL
    ? model.replace(/-(high|low)$/, "")
    : model;
  return [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: selectedModel,
      options: [{ value: selectedModel, name: selectedModel }],
    },
    {
      id: "effort",
      name: "Effort",
      category: "thought_level",
      type: "select",
      currentValue: "low",
      options: [{ value: "low", name: "Low" }],
    },
  ];
}
function session() {
  const availableModes = [{ id: "default", name: "Default" }];
  if (process.env.AGY_TEST_AUTO_UNAVAILABLE !== "yes")
    availableModes.push({ id: "auto", name: "Auto" });
  if (process.env.AGY_TEST_ACCEPT_EDITS_UNAVAILABLE !== "yes")
    availableModes.push({ id: "accept-edits", name: "Accept Edits" });
  return { sessionId, modes: { currentModeId: mode, availableModes }, configOptions: options() };
}
function complete(text) {
  send({
    method: "session/update",
    params: {
      sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    },
  });
  send({ id: pendingPrompt, result: { stopReason: "end_turn" } });
  pendingPrompt = undefined;
}
lines.on("line", (line) => {
  const input = JSON.parse(line);
  if (process.env.AGY_TEST_LOG)
    appendFileSync(process.env.AGY_TEST_LOG, `${JSON.stringify({ acp: input })}\n`);
  if (input.method === "initialize") {
    send({
      id: input.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
      },
    });
  } else if (input.method === "session/new" || input.method === "session/load") {
    sessionId = input.params.sessionId ?? "0c19650f-b73a-4dd2-985c-8b9256199fe0";
    send({ id: input.id, result: session() });
  } else if (input.method === "session/set_mode") {
    mode = input.params.modeId;
    send({ id: input.id, result: {} });
  } else if (input.method === "session/set_config_option") {
    model = input.params.value;
    send({ id: input.id, result: { configOptions: options() } });
  } else if (input.method === "session/prompt") {
    pendingPrompt = input.id;
    const text = input.params.prompt
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    if (text.includes("APPROVAL") && !process.argv.includes("--dangerously-skip-permissions")) {
      send({
        id: "approval",
        method: "session/request_permission",
        params: {
          sessionId,
          toolCall: {
            toolCallId: "command",
            title: "Run command",
            kind: "execute",
            status: "pending",
            rawInput: { command: "example" },
          },
          options: [
            { optionId: "allow", name: "Allow", kind: "allow_once" },
            { optionId: "deny", name: "Deny", kind: "reject_once" },
          ],
        },
      });
    } else complete("ACP HELLO");
  } else if (input.method === "session/cancel") {
    if (pendingPrompt !== undefined)
      send({ id: pendingPrompt, result: { stopReason: "cancelled" } });
    pendingPrompt = undefined;
  } else if (input.id === "approval") {
    if (pendingPrompt !== undefined)
      complete(input.result.outcome.optionId === "allow" ? "ALLOWED" : "DENIED");
  } else if (input.id !== undefined) {
    send({ id: input.id, result: {} });
  }
});
lines.on("close", () => process.exit(0));
