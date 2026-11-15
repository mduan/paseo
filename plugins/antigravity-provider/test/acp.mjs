import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
let sessionId;
let model = "gemini-3.8-flash";
let effort = "low";
let mode = "default";
let pendingPrompt;
let backgroundChecks = 0;
let background = false;
function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}
function options() {
  return [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: model,
      options: [{ value: model, name: model }],
    },
    ...(model === "gpt-oss-120b-medium"
      ? []
      : [
          {
            id: "thought_level",
            name: "Thinking Level",
            category: "thought_level",
            type: "select",
            currentValue: effort,
            options: (model === "gemini-3.1-pro"
              ? ["low", "high"]
              : ["low", "medium", "high", ...(model === "gemini-4-hydrogen" ? ["xhigh"] : [])]
            ).map((value) => ({ value, name: value })),
          },
        ]),
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
function configure(input) {
  if (input.params.configId === "model") {
    model = input.params.value;
    if (model === "gemini-3.1-pro" && effort === "medium") effort = "low";
  } else if (input.params.configId === "thought_level") {
    if (
      !options()
        .find((option) => option.category === "thought_level")
        ?.options.some((option) => option.value === input.params.value)
    ) {
      send({ id: input.id, error: { code: -32602, message: "Unsupported effort" } });
      return;
    }
    effort = input.params.value;
  }
  send({ id: input.id, result: { configOptions: options() } });
}
function backgroundPrompt(text) {
  if (text.endsWith("BACKGROUND")) {
    background = true;
    send({
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "background-command",
          title: "Background command",
          kind: "execute",
          status: "in_progress",
          rawInput: { CommandLine: "sleep 30", WaitMsBeforeAsync: 500 },
        },
      },
    });
    complete("Background task started");
  } else {
    backgroundChecks++;
    if (process.env.AGY_TEST_CHECK_HOLD === "yes") {
      send({
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "Checking background task" },
          },
        },
      });
      return;
    }
    if (process.env.AGY_TEST_CHECK_FAIL === "yes") {
      send({ id: pendingPrompt, error: { code: -32603, message: "Background check failed" } });
      pendingPrompt = undefined;
      return;
    }
    if (background && backgroundChecks === 2 && process.env.AGY_TEST_BACKGROUND_NEVER !== "yes") {
      send({
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "background-command",
            status: "completed",
            rawOutput: { output: "BACKGROUND RESULT" },
          },
        },
      });
      send({
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Genuine completion result" },
          },
        },
      });
      // The echoed user message separates buffered background output from the new reply.
      send({
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text },
          },
        },
      });
      background = false;
    }
    send({
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "PASEO_BACKGROUND_" },
        },
      },
    });
    complete("PENDING");
  }
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
    setTimeout(
      () =>
        send({
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [
                { name: "project-skill", description: "Project skill", input: { hint: "task" } },
              ],
            },
          },
        }),
      50,
    );
  } else if (input.method === "session/set_mode") {
    mode = input.params.modeId;
    send({ id: input.id, result: {} });
  } else if (input.method === "session/set_config_option") {
    configure(input);
  } else if (input.method === "session/prompt") {
    if (pendingPrompt !== undefined) {
      send({ id: pendingPrompt, result: { stopReason: "end_turn" } });
      pendingPrompt = input.id;
      send({
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "STEERED" },
          },
        },
      });
      return;
    }
    pendingPrompt = input.id;
    const text = input.params.prompt
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    if (text.includes("BACKGROUND")) {
      backgroundPrompt(text);
    } else if (text.includes("HOLD")) {
      send({
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "WORKING" },
          },
        },
      });
    } else if (
      text.includes("APPROVAL") &&
      !process.argv.includes("--dangerously-skip-permissions")
    ) {
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
