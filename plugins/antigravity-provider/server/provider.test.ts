import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDER_CAPABILITIES,
  ProviderEventSchema,
  type ProviderConnection,
  type ProviderContent,
  type ProviderEvent,
  type ProviderInput,
  type ProviderLaunch,
  type ProviderPersistence,
} from "@getpaseo/plugin/server/provider";
import { signalPlan } from "./internal/signals.js";
import { createAntigravityProvider } from "./provider.js";

const temporary: string[] = [];
const connections: ProviderConnection[] = [];
const fake = fileURLToPath(new URL("../test/agy.mjs", import.meta.url));
const provider = createAntigravityProvider();

it("publishes a monochrome, theme-aware provider icon", async () => {
  const icon = await readFile(new URL("../icon.svg", import.meta.url), "utf8");
  expect(icon).toContain('viewBox="0 0 24 24"');
  expect(icon).toContain('fill="currentColor"');
  expect(icon).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(|url\(/i);
  expect(icon).not.toMatch(/<(?:style|mask|defs|linearGradient|radialGradient)\b|\bid=/i);
  expect([...icon.matchAll(/\b(?:fill|stroke)="([^"]+)"/g)].map((match) => match[1])).toEqual([
    "currentColor",
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function harness(env: Record<string, string> = {}) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "antigravity-test-"));
  temporary.push(cwd);
  const log = path.join(cwd, "argv.ndjson");
  const launch: ProviderLaunch = {
    command: process.execPath,
    args: [
      fake,
      "--launch-prefix",
      ...(env.AGY_TEST_SKIP ? ["--dangerously-skip-permissions"] : []),
    ],
    env: { AGY_TEST_LOG: log, ...env },
  };
  const connection = await provider.connect({
    versions: [1],
    capabilities: PROVIDER_CAPABILITIES,
    launch,
  });
  connections.push(connection);
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => {
    ProviderEventSchema.parse(event);
    events.push(event);
  });
  async function wait(predicate: (event: ProviderEvent) => boolean) {
    await expect.poll(() => events.some(predicate), { timeout: 5000, interval: 10 }).toBe(true);
    const event = events.find(predicate);
    if (!event) throw new Error("Expected event missing");
    return event;
  }
  async function request(input: ProviderInput) {
    await connection.send(input);
    if ("requestId" in input)
      await wait(
        (event) =>
          "requestId" in event &&
          event.requestId === input.requestId &&
          (event.type === "request.completed" ||
            event.type === "request.failed" ||
            event.type === "session.ready" ||
            event.type === "catalog"),
      );
  }
  async function open(restored?: ProviderPersistence, sessionId = "s") {
    await request({
      type: "session.open",
      requestId: `open-${events.length}`,
      sessionId,
      persistence: restored,
      history: "replay",
      config: {
        cwd,
        mode: env.AGY_TEST_MODE,
        model: env.AGY_TEST_MODEL,
        thinkingOption: env.AGY_TEST_EFFORT,
        env: { AGY_SESSION_VALUE: "session-overlay" },
        settings: {},
        mcpServers: {},
        persist: env.AGY_TEST_NO_PERSIST !== "yes",
        systemPrompt: "SYSTEM PREFIX",
      },
    });
  }
  async function message(content: ProviderContent[], sessionId = "s") {
    const clientMessageId = `prompt-${events.length}`;
    await connection.send({
      type: "session.prompt",
      sessionId,
      prompt: {
        clientMessageId,
        delivery: "auto",
        input: { type: "message", content },
      },
    });
    await wait(
      (event) =>
        event.type === "session.prompt_result" && event.clientMessageId === clientMessageId,
    );
    return clientMessageId;
  }
  function prompt(text: string) {
    return message([{ type: "text", text }]);
  }
  async function completed(clientMessageId: string) {
    const result = events.find(
      (event) =>
        event.type === "session.prompt_result" && event.clientMessageId === clientMessageId,
    );
    if (!result || result.type !== "session.prompt_result" || result.result.type !== "turn")
      throw new Error("Prompt was not admitted");
    const turnId = result.result.turnId;
    return wait(
      (event) =>
        event.type === "session.turn" && event.turnId === turnId && event.state !== "started",
    );
  }
  async function records() {
    return (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }
  function persistence() {
    const opened = events.find((event) => event.type === "session.opened");
    if (!opened || opened.type !== "session.opened" || !opened.persistence)
      throw new Error("Missing persistence");
    return opened.persistence;
  }
  return {
    connection,
    events,
    launch,
    cwd,
    wait,
    request,
    open,
    prompt,
    message,
    completed,
    records,
    persistence,
  };
}

function accelerateBackgroundChecks() {
  const schedule = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, delay, ...args) =>
    schedule(callback, delay === 10000 ? 1 : delay, ...args),
  );
}

describe("ACP permission modes", () => {
  it("checks unfinished background tools, hides synthetic messages, and preserves the completion", async () => {
    const h = await harness();
    await h.open();
    const promptId = await h.prompt("BACKGROUND");
    await h.wait(
      (event) =>
        event.type === "timeline.item" &&
        event.item.type === "assistant_message" &&
        event.item.text === "Background task started",
    );
    expect(h.events.filter((event) => event.type === "session.turn")).toHaveLength(1);
    async function promptCount() {
      return (await h.records()).filter((record) => record.acp?.method === "session/prompt").length;
    }
    await expect.poll(promptCount, { timeout: 25000, interval: 20 }).toBe(3);
    expect(await h.completed(promptId)).toMatchObject({ state: "completed" });
    const messages = h.events.filter(
      (event) =>
        event.type === "timeline.item" &&
        (event.item.type === "user_message" || event.item.type === "assistant_message"),
    );
    expect(
      messages.map((event) =>
        event.type === "timeline.item" && "text" in event.item ? event.item.text : undefined,
      ),
    ).toEqual(["BACKGROUND", "Background task started", "Genuine completion result"]);
    expect(h.events.filter((event) => event.type === "session.prompt_result")).toHaveLength(1);
    expect(
      h.events
        .filter((event) => event.type === "session.turn")
        .map((event) => (event.type === "session.turn" ? event.state : undefined)),
    ).toEqual(["started", "completed"]);
  }, 30000);

  it("stops waiting for background work when interrupted", async () => {
    const h = await harness();
    await h.open();
    const promptId = await h.prompt("BACKGROUND");
    await h.wait(
      (event) =>
        event.type === "timeline.item" &&
        event.item.type === "assistant_message" &&
        event.item.text === "Background task started",
    );
    await h.request({ type: "session.interrupt", requestId: "stop-background", sessionId: "s" });
    expect(await h.completed(promptId)).toMatchObject({ state: "canceled" });
    expect(
      h.events.findLast(
        (event) => event.type === "timeline.item" && event.item.type === "tool_call",
      ),
    ).toMatchObject({ item: { status: "canceled" } });
    expect(await h.completed(await h.prompt("HELLO"))).toMatchObject({ state: "completed" });
  });

  it("accepts user steering between background checks", async () => {
    const h = await harness();
    await h.open();
    const promptId = await h.prompt("BACKGROUND");
    await h.wait(
      (event) =>
        event.type === "timeline.item" &&
        event.item.type === "assistant_message" &&
        event.item.text === "Background task started",
    );
    await h.connection.send({
      type: "session.prompt",
      sessionId: "s",
      prompt: {
        clientMessageId: "background-steer",
        delivery: "steer",
        input: { type: "message", content: [{ type: "text", text: "change course" }] },
      },
    });
    expect(
      await h.wait(
        (event) =>
          event.type === "session.prompt_result" && event.clientMessageId === "background-steer",
      ),
    ).toMatchObject({ result: { type: "steer" } });
    await h.wait(
      (event) =>
        event.type === "timeline.item" &&
        event.item.type === "assistant_message" &&
        event.item.text === "ACP HELLO",
    );
    await h.request({
      type: "session.interrupt",
      requestId: "stop-steered-background",
      sessionId: "s",
    });
    expect(await h.completed(promptId)).toMatchObject({ state: "canceled" });
  });

  it("preserves user steering during an automatic check without exposing its prompt", async () => {
    const h = await harness({ AGY_TEST_CHECK_HOLD: "yes" });
    await h.open();
    accelerateBackgroundChecks();
    const promptId = await h.prompt("BACKGROUND");
    await h.wait(
      (event) =>
        event.type === "timeline.item" &&
        event.item.type === "reasoning" &&
        event.item.text === "Checking background task",
    );
    await h.connection.send({
      type: "session.prompt",
      sessionId: "s",
      prompt: {
        clientMessageId: "during-check",
        delivery: "steer",
        input: { type: "message", content: [{ type: "text", text: "change course" }] },
      },
    });
    expect(
      await h.wait(
        (event) =>
          event.type === "session.prompt_result" && event.clientMessageId === "during-check",
      ),
    ).toMatchObject({ result: { type: "steer" } });
    await h.request({ type: "session.interrupt", requestId: "stop-check", sessionId: "s" });
    expect(await h.completed(promptId)).toMatchObject({ state: "canceled" });
    const userMessages = h.events.filter(
      (event) => event.type === "timeline.item" && event.item.type === "user_message",
    );
    expect(
      userMessages.map((event) =>
        event.type === "timeline.item" && "text" in event.item ? event.item.text : undefined,
      ),
    ).toEqual(["BACKGROUND", "change course"]);
    expect(h.events).toContainEqual(
      expect.objectContaining({
        type: "timeline.item",
        item: expect.objectContaining({ type: "assistant_message", text: "STEERED" }),
      }),
    );
  });

  it.each([
    {
      env: { AGY_TEST_BACKGROUND_NEVER: "yes" },
      expectedChecks: 30,
      error: "Background checks stopped after 30 attempts",
    },
    { env: { AGY_TEST_CHECK_FAIL: "yes" }, expectedChecks: 1, error: "Background check failed" },
  ])(
    "ends the turn when background checks fail or reach their bound ($expectedChecks)",
    async ({ env, expectedChecks, error }) => {
      const h = await harness(env);
      await h.open();
      accelerateBackgroundChecks();
      const promptId = await h.prompt("BACKGROUND");
      const ended = await h.completed(promptId);
      expect(ended).toMatchObject({
        state: "failed",
        error: { message: expect.stringContaining(error) },
      });
      const records = await h.records();
      expect(records.filter((record) => record.acp?.method === "session/prompt")).toHaveLength(
        expectedChecks + 1,
      );
      expect(h.events.filter((event) => event.type === "session.prompt_result")).toHaveLength(1);
    },
  );

  it("exposes ACP skills and forwards their invocations", async () => {
    const h = await harness();
    await h.open();
    expect(h.events).toContainEqual({
      type: "session.commands",
      sessionId: "s",
      commands: [{ name: "project-skill", description: "Project skill", argumentHint: "task" }],
    });
    await h.connection.send({
      type: "session.prompt",
      sessionId: "s",
      prompt: {
        clientMessageId: "skill-prompt",
        delivery: "auto",
        input: { type: "command", name: "project-skill", arguments: "review changes" },
      },
    });
    await h.wait(
      (event) => event.type === "session.prompt_result" && event.clientMessageId === "skill-prompt",
    );
    await h.completed("skill-prompt");
    const records = await h.records();
    const prompt = records.find((record) => record.acp?.method === "session/prompt");
    expect(prompt.acp.params.prompt).toEqual([
      { type: "text", text: "SYSTEM PREFIX" },
      { type: "text", text: "/project-skill review changes" },
    ]);
    expect(h.events).toContainEqual(
      expect.objectContaining({
        type: "timeline.item",
        item: expect.objectContaining({
          type: "user_message",
          text: "/project-skill review changes",
        }),
      }),
    );
  });

  it("runs Full access through ACP with native permission bypass and preserves launch configuration", async () => {
    const h = await harness();
    await h.open();
    await h.completed(await h.prompt("APPROVAL"));
    const records = await h.records();
    const launches = records.filter((record) => record.args?.includes("acp"));
    expect(launches.length).toBeGreaterThan(0);
    expect(launches.every((record) => record.args.includes("--dangerously-skip-permissions"))).toBe(
      true,
    );
    expect(
      launches.every(
        (record) =>
          record.args.includes("--launch-prefix") && record.args.includes("--process-per-session"),
      ),
    ).toBe(true);
    expect(launches.some((record) => record.env === "session-overlay")).toBe(true);
    expect(records.some((record) => record.args?.includes("--input-format"))).toBe(false);
    expect(
      records.find((record) => record.acp?.method === "session/set_mode").acp.params.modeId,
    ).toBe("default");
    expect(h.events.some((event) => event.type === "session.permission")).toBe(false);
    expect(h.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "session.config",
          config: expect.objectContaining({ mode: "full-access" }),
        }),
        expect.objectContaining({
          type: "session.notice",
          notice: expect.objectContaining({
            id: "s:full-access",
            title: "Antigravity is running with full access",
          }),
        }),
      ]),
    );
  });

  it("preserves the Full access warning across model reloads and dismisses it when approval is enabled", async () => {
    const h = await harness();
    await h.open();
    await h.completed(await h.prompt("FIRST"));
    await h.request({
      type: "session.configure",
      requestId: "model",
      sessionId: "s",
      changes: { model: "gemini-3.8-flash-low" },
    });
    await h.completed(await h.prompt("SECOND"));
    expect(
      h.events.filter((event) => event.type === "session.notice" && !event.notice.dismissed),
    ).toHaveLength(1);
    await h.request({
      type: "session.configure",
      requestId: "auto",
      sessionId: "s",
      changes: { mode: "auto" },
    });
    await h.completed(await h.prompt("THIRD"));
    expect(h.events.findLast((event) => event.type === "session.notice")).toMatchObject({
      notice: { id: "s:full-access", dismissed: true },
    });
  });

  it("rejects combined model IDs when opening a session", async () => {
    const h = await harness({ AGY_TEST_MODEL: "gemini-3.8-flash-high" });
    await h.open();
    expect(h.events.find((event) => event.type === "request.failed")).toMatchObject({
      error: { code: "INVALID_MODEL" },
    });
  });

  it("rejects combined model IDs when configuring a session", async () => {
    const h = await harness({ AGY_TEST_MODEL: "gemini-3.8-flash" });
    await h.open();
    await h.request({
      type: "session.configure",
      requestId: "combined-model",
      sessionId: "s",
      changes: { model: "gemini-3.8-flash-low" },
    });
    expect(h.events.find((event) => event.type === "request.failed")).toMatchObject({
      requestId: "combined-model",
      error: { code: "INVALID_MODEL" },
    });
  });

  it.each(["full-access", "auto", "accept-edits"])(
    "changes effort separately in %s without losing the conversation",
    async (mode) => {
      const h = await harness({
        AGY_TEST_MODE: mode,
        AGY_TEST_MODEL: "gemini-3.8-flash",
        AGY_TEST_EFFORT: "high",
      });
      await h.open();
      await h.completed(await h.prompt("FIRST"));
      const persistence = h.persistence();
      await h.request({
        type: "session.configure",
        requestId: "effort",
        sessionId: "s",
        changes: { thinkingOption: "low" },
      });
      expect(h.events.findLast((event) => event.type === "session.config")).toMatchObject({
        config: { model: "gemini-3.8-flash", thinkingOption: "low" },
      });
      await h.completed(await h.prompt("SECOND"));
      const records = await h.records();
      expect(
        records
          .filter(
            (record) =>
              record.acp?.method === "session/set_config_option" &&
              record.acp.params.configId === "thought_level",
          )
          .map((record) => record.acp.params.value),
      ).toEqual(["high", "low"]);
      expect(
        records.find((record) => record.acp?.method === "session/load").acp.params.sessionId,
      ).toBe(persistence.data.conversationId);
    },
  );

  it("rejects unsupported effort and keeps the previous selection", async () => {
    const h = await harness({ AGY_TEST_MODEL: "gemini-3.1-pro", AGY_TEST_EFFORT: "high" });
    await h.open();
    await h.request({
      type: "session.configure",
      requestId: "invalid-effort",
      sessionId: "s",
      changes: { thinkingOption: "medium" },
    });
    expect(h.events.find((event) => event.type === "request.failed")).toMatchObject({
      requestId: "invalid-effort",
      error: { code: "INVALID_THINKING" },
    });
    await h.completed(await h.prompt("FIRST"));
    expect(h.events.findLast((event) => event.type === "session.config")).toMatchObject({
      config: { model: "gemini-3.1-pro", thinkingOption: "high" },
    });
  });

  it("clears effort when switching to a fixed-effort model", async () => {
    const h = await harness({
      AGY_TEST_CATALOG:
        "gemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\ngpt-oss-120b-medium\tGPT-OSS 120B (Medium)",
      AGY_TEST_MODEL: "gemini-3.8-flash",
      AGY_TEST_EFFORT: "high",
    });
    await h.open();
    await h.request({
      type: "session.configure",
      requestId: "fixed",
      sessionId: "s",
      changes: { model: "gpt-oss-120b-medium" },
    });
    await h.completed(await h.prompt("FIRST"));
    expect(h.events.findLast((event) => event.type === "session.config")).toMatchObject({
      config: { model: "gpt-oss-120b-medium", thinkingOption: undefined, thinkingOptions: [] },
    });
  });

  it.each([
    { mode: "auto", behavior: "allow" },
    { mode: "auto", behavior: "deny" },
    { mode: "accept-edits", behavior: "allow" },
    { mode: "accept-edits", behavior: "deny" },
  ] as const)(
    "returns $behavior to the native $mode permission request",
    async ({ mode, behavior }) => {
      const h = await harness({ AGY_TEST_VERSION: "1.5.9", AGY_TEST_MODE: mode });
      await h.open();
      expect(
        h.events.some((event) => event.type === "session.notice" && !event.notice.dismissed),
      ).toBe(false);
      const promptId = await h.prompt("APPROVAL");
      const permission = await h.wait((event) => event.type === "session.permission");
      if (permission.type !== "session.permission") throw new Error("Missing permission");
      expect(
        h.events.some((event) => event.type === "session.turn" && event.state === "completed"),
      ).toBe(false);
      await h.connection.send({
        type: "session.permission",
        sessionId: "s",
        permissionId: permission.request.id,
        response: { behavior, selectedActionId: behavior },
      });
      await h.completed(promptId);
      expect(h.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "timeline.item",
            item: expect.objectContaining({
              type: "assistant_message",
              text: behavior === "allow" ? "ALLOWED" : "DENIED",
            }),
          }),
          expect.objectContaining({
            type: "timeline.item",
            item: expect.objectContaining({ type: "user_message", text: "APPROVAL" }),
          }),
        ]),
      );
      const records = await h.records();
      expect(
        records
          .filter((record) => record.args?.includes("acp"))
          .every((record) => !record.args.includes("--dangerously-skip-permissions")),
      ).toBe(true);
      expect(
        records.find((record) => record.acp?.method === "session/set_mode").acp.params.modeId,
      ).toBe(mode);
      expect(
        records.find((record) => record.acp?.method === "session/prompt").acp.params.prompt,
      ).toEqual([
        { type: "text", text: "SYSTEM PREFIX" },
        { type: "text", text: "APPROVAL" },
      ]);
    },
  );

  it("cancels a pending approval and admits the next turn", async () => {
    const h = await harness({ AGY_TEST_VERSION: "1.5.9", AGY_TEST_MODE: "auto" });
    await h.open();
    const promptId = await h.prompt("APPROVAL");
    await h.wait((event) => event.type === "session.permission");
    await h.request({ type: "session.interrupt", requestId: "stop", sessionId: "s" });
    expect(await h.completed(promptId)).toMatchObject({ state: "canceled" });
    expect(await h.completed(await h.prompt("HELLO"))).toMatchObject({ state: "completed" });
  });

  it("steers the running ACP turn without cancelling it and still supports interrupt", async () => {
    const h = await harness();
    await h.open();
    expect(h.connection.capabilities).toContain("prompt.steer");
    const promptId = await h.prompt("HOLD");
    await h.wait(
      (event) => event.type === "timeline.item" && event.item.type === "assistant_message",
    );
    const admission = h.events.find(
      (event) => event.type === "session.prompt_result" && event.clientMessageId === promptId,
    );
    if (admission?.type !== "session.prompt_result" || admission.result.type !== "turn")
      throw new Error("Expected an active turn");
    const turnId = admission.result.turnId;

    await h.connection.send({
      type: "session.prompt",
      sessionId: "s",
      prompt: {
        clientMessageId: "steer-1",
        delivery: "steer",
        input: { type: "message", content: [{ type: "text", text: "change course" }] },
      },
    });
    expect(
      await h.wait(
        (event) => event.type === "session.prompt_result" && event.clientMessageId === "steer-1",
      ),
    ).toMatchObject({ result: { type: "steer", turnId } });
    await h.wait(
      (event) =>
        event.type === "timeline.item" &&
        event.item.type === "assistant_message" &&
        event.item.text === "WORKINGSTEERED",
    );
    const records = await h.records();
    expect(records.filter((record) => record.acp?.method === "session/cancel")).toEqual([]);
    expect(
      records
        .filter((record) => record.acp?.method === "session/prompt")
        .map((record) => record.acp.params.prompt),
    ).toEqual([
      [
        { type: "text", text: "SYSTEM PREFIX" },
        { type: "text", text: "HOLD" },
      ],
      [{ type: "text", text: "change course" }],
    ]);
    expect(h.events.filter((event) => event.type === "session.turn")).toEqual([
      { type: "session.turn", sessionId: "s", turnId, state: "started" },
    ]);

    await h.request({ type: "session.interrupt", requestId: "stop-steered", sessionId: "s" });
    expect(await h.completed(promptId)).toMatchObject({ state: "canceled" });
    expect(await h.completed(await h.prompt("HELLO"))).toMatchObject({ state: "completed" });
  });

  it.each([false, true])(
    "clears pending permissions only when a steer requests it (%s)",
    async (clearPendingPermissions) => {
      const h = await harness({ AGY_TEST_MODE: "auto" });
      await h.open();
      const promptId = await h.prompt("APPROVAL");
      await h.wait((event) => event.type === "session.permission");
      await h.connection.send({
        type: "session.prompt",
        sessionId: "s",
        prompt: {
          clientMessageId: "permission-steer",
          delivery: "steer",
          clearPendingPermissions,
          input: { type: "message", content: [{ type: "text", text: "change course" }] },
        },
      });
      await h.wait(
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "assistant_message" &&
          event.item.text.startsWith("STEERED"),
      );
      if (clearPendingPermissions) {
        await h.wait((event) => event.type === "session.permission_resolved");
        expect(await h.completed(promptId)).toMatchObject({ state: "completed" });
      } else {
        expect(h.events.filter((event) => event.type === "session.permission_resolved")).toEqual(
          [],
        );
        await h.request({ type: "session.interrupt", requestId: "stop-blocked", sessionId: "s" });
        expect(await h.completed(promptId)).toMatchObject({ state: "canceled" });
      }
      const methods = (await h.records())
        .filter((record) => record.acp?.method)
        .map((record) => record.acp.method);
      expect(methods.filter((method) => method === "session/prompt")).toHaveLength(2);
    },
  );

  it.each(["auto", "accept-edits"])(
    "rejects %s when the native session does not offer it",
    async (mode) => {
      const h = await harness({
        AGY_TEST_VERSION: "1.5.9",
        AGY_TEST_MODE: mode,
        [mode === "auto" ? "AGY_TEST_AUTO_UNAVAILABLE" : "AGY_TEST_ACCEPT_EDITS_UNAVAILABLE"]:
          "yes",
      });
      await h.open();
      expect(h.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "request.failed",
            error: expect.objectContaining({ code: "UNSUPPORTED_MODE" }),
          }),
        ]),
      );
      expect((await h.records()).some((record) => record.acp?.method === "session/prompt")).toBe(
        false,
      );
    },
  );

  it("switches between all modes while preserving the conversation", async () => {
    const h = await harness({ AGY_TEST_VERSION: "1.5.9" });
    await h.open();
    const persistence = h.persistence();
    await h.request({
      type: "session.configure",
      requestId: "accept-edits",
      sessionId: "s",
      changes: { mode: "accept-edits" },
    });
    await h.completed(await h.prompt("HELLO ACCEPT EDITS"));
    await h.request({
      type: "session.configure",
      requestId: "auto",
      sessionId: "s",
      changes: { mode: "auto" },
    });
    await h.completed(await h.prompt("HELLO AUTO"));
    await h.request({
      type: "session.configure",
      requestId: "full",
      sessionId: "s",
      changes: { mode: "full-access" },
    });
    await h.completed(await h.prompt("HELLO FULL"));
    const records = await h.records();
    expect(
      records.find((record) => record.acp?.method === "session/load").acp.params.sessionId,
    ).toBe(persistence.data.conversationId);
    expect(
      records.find((record) => record.acp?.method === "session/prompt").acp.params.prompt[0],
    ).toEqual({ type: "text", text: "SYSTEM PREFIX" });
    expect(
      records
        .filter((record) => record.acp?.method === "session/set_mode")
        .map((record) => record.acp.params.modeId),
    ).toEqual(["default", "accept-edits", "auto", "default"]);
    const launches = records.filter((record) => record.args?.includes("acp"));
    expect(launches.every((record) => !record.args.includes("--input-format"))).toBe(true);
    expect(launches[0].args).toContain("--dangerously-skip-permissions");
    expect(launches.at(-1).args).toContain("--dangerously-skip-permissions");
    expect(launches.some((record) => !record.args.includes("--dangerously-skip-permissions"))).toBe(
      true,
    );
    const loads = records.filter((record) => record.acp?.method === "session/load");
    expect(loads).toHaveLength(3);
    expect(
      loads.every((record) => record.acp.params.sessionId === persistence.data.conversationId),
    ).toBe(true);
    expect(h.events.filter((event) => event.type === "session.opened")).toHaveLength(1);
  });

  it.each(["full-access", "auto", "accept-edits"])(
    "resumes %s conversations and passes images through ACP without repeating the system prompt",
    async (mode) => {
      const h = await harness({ AGY_TEST_MODE: mode });
      await h.open();
      await h.completed(await h.prompt("FIRST"));
      const persistence = h.persistence();
      await h.request({ type: "session.close", requestId: "close", sessionId: "s" });
      await h.open(persistence);
      const image: ProviderContent = { type: "image", mimeType: "image/png", data: "aW1hZ2U=" };
      await h.completed(await h.message([{ type: "text", text: "SECOND" }, image]));
      const prompts = (await h.records()).filter(
        (record) => record.acp?.method === "session/prompt",
      );
      expect(prompts.at(-1).acp.params.prompt).toEqual([{ type: "text", text: "SECOND" }, image]);
    },
  );

  it("does not expose persistence when disabled, including after a mode change", async () => {
    const h = await harness({ AGY_TEST_VERSION: "1.5.9", AGY_TEST_NO_PERSIST: "yes" });
    await h.open();
    await h.request({
      type: "session.configure",
      requestId: "auto",
      sessionId: "s",
      changes: { mode: "auto" },
    });
    await h.completed(await h.prompt("HELLO"));
    expect(
      h.events
        .filter((event) => event.type === "session.opened")
        .every((event) => event.type === "session.opened" && event.persistence === undefined),
    ).toBe(true);
    expect(h.events.some((event) => event.type === "session.persistence")).toBe(false);
    expect((await h.records()).some((record) => record.acp?.method === "session/load")).toBe(true);
  });

  it("rejects a command configured to bypass permissions in Auto mode", async () => {
    const h = await harness({
      AGY_TEST_VERSION: "1.5.9",
      AGY_TEST_MODE: "auto",
      AGY_TEST_SKIP: "yes",
    });
    await h.open();
    expect(h.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "request.failed",
          error: expect.objectContaining({
            message: expect.stringContaining("Remove --dangerously-skip-permissions"),
          }),
        }),
      ]),
    );
    expect((await h.records()).some((record) => record.args?.includes("acp"))).toBe(false);
  });
});

describe("discovery", () => {
  it("reuses one discovered catalog for two opens and configure, and refreshes explicit catalog requests", async () => {
    const h = await harness();
    await h.open();
    await h.open(undefined, "second");
    await h.request({
      type: "session.configure",
      requestId: "configure-cached",
      sessionId: "second",
      changes: { model: "gemini-3.8-flash-low" },
    });
    expect(
      (await h.records()).filter((entry) => entry.args && entry.args.includes("models")),
    ).toHaveLength(1);
    await h.request({ type: "catalog", requestId: "refresh" });
    expect(
      (await h.records()).filter((entry) => entry.args && entry.args.includes("models")),
    ).toHaveLength(2);
  });
  it.each(["1.5.0", "1.5.9"])("accepts ACP-capable version %s", async (version) => {
    const h = await harness({ AGY_TEST_VERSION: version });
    expect(await provider.status?.({ launch: h.launch })).toEqual({ available: true });
  });

  it("exposes Accept File Edits alongside Auto and Full access on ACP-capable versions", async () => {
    const h = await harness({ AGY_TEST_VERSION: "1.5.9" });
    await h.request({ type: "catalog", requestId: "catalog" });
    const event = h.events[0];
    expect(event).toMatchObject({
      type: "catalog",
      catalog: {
        defaultMode: "full-access",
        modes: [
          expect.objectContaining({ id: "accept-edits", label: "Accept File Edits" }),
          expect.objectContaining({ id: "auto", label: "Auto" }),
          expect.objectContaining({ id: "full-access", label: "Full access" }),
        ],
      },
    });
  });

  it("groups model families and exposes only their supported efforts", async () => {
    const h = await harness();
    await h.request({ type: "catalog", requestId: "catalog" });
    const event = h.events[0];
    expect(event).toMatchObject({
      type: "catalog",
      catalog: {
        models: expect.arrayContaining([
          expect.objectContaining({
            id: "gemini-3.8-flash",
            label: "Gemini 3.8 Flash",
            thinkingOptions: [
              { id: "low", label: "Low" },
              { id: "medium", label: "Medium" },
              { id: "high", label: "High" },
            ],
          }),
        ]),
        defaultMode: "full-access",
      },
    });
    if (event.type !== "catalog") throw new Error("Missing catalog");
    expect(event.catalog.models).toHaveLength(4);
    expect(
      event.catalog.models.find((model) => model.id === "gemini-3.1-pro")?.thinkingOptions,
    ).toEqual([
      { id: "low", label: "Low" },
      { id: "high", label: "High" },
    ]);
    expect(event.catalog.modes.map((mode) => mode.id)).toEqual([
      "accept-edits",
      "auto",
      "full-access",
    ]);
  });
  it("keeps fixed-effort IDs literal and exposes Extra with the native xhigh value", async () => {
    const h = await harness({
      AGY_TEST_CATALOG:
        "gemini-4-hydrogen-high\tGemini 4 Hydrogen (High)\ngemini-4-hydrogen-xhigh\tGemini 4 Hydrogen (XHigh)\ngpt-oss-120b-medium\tGPT-OSS 120B (Medium)",
    });
    await h.request({ type: "catalog", requestId: "catalog" });
    expect(h.events[0]).toMatchObject({
      type: "catalog",
      catalog: {
        models: [
          {
            id: "gemini-4-hydrogen",
            label: "Gemini 4 Hydrogen",
            thinkingOptions: [
              { id: "high", label: "High" },
              { id: "xhigh", label: "Extra" },
            ],
          },
          { id: "gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium)", thinkingOptions: [] },
        ],
      },
    });
  });

  it("reports missing, old, unauthenticated and available launches", async () => {
    expect(await provider.status?.({})).toMatchObject({
      available: false,
      diagnostic: expect.stringContaining("agy not found"),
    });
    const missing = await harness();
    expect(
      await provider.status?.({
        launch: { ...missing.launch, command: path.join(missing.cwd, "missing-agy") },
      }),
    ).toMatchObject({ available: false, diagnostic: expect.stringContaining("ENOENT") });
    const old = await harness({ AGY_TEST_VERSION: "1.4.12" });
    expect(await provider.status?.({ launch: old.launch })).toMatchObject({
      available: false,
      diagnostic: expect.stringContaining("1.5.0"),
    });
    const unauthenticated = await harness({ AGY_TEST_AUTH: "missing" });
    expect(await provider.status?.({ launch: unauthenticated.launch })).toEqual({
      available: false,
      diagnostic: "Antigravity authentication failed. Run `agy` and sign in, then retry.",
    });
    const authenticated = await harness();
    expect(await provider.status?.({ launch: authenticated.launch })).toEqual({ available: true });
  });
  it("keys catalog caching by the complete effective launch without exposing env values", async () => {
    const h = await harness();
    const key = await provider.getCatalogCacheKey?.({ scope: "global", launch: h.launch });
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await provider.getCatalogCacheKey?.({
        scope: "workspace",
        cwd: h.cwd,
        force: true,
        launch: h.launch,
      }),
    ).toBe(key);
    expect(
      await provider.getCatalogCacheKey?.({
        scope: "global",
        launch: { ...h.launch, args: [...h.launch.args, "changed"] },
      }),
    ).not.toBe(key);
    expect(
      await provider.getCatalogCacheKey?.({
        scope: "global",
        launch: { ...h.launch, env: { ...h.launch.env, HOME: "different" } },
      }),
    ).not.toBe(key);
  });
});

describe("process signal plans", () => {
  it.each(["SIGINT", "SIGTERM", "SIGKILL"] as const)("kills the Windows tree for %s", (signal) => {
    expect(signalPlan({ platform: "win32", pid: 123, signal })).toEqual({
      type: "tree",
      command: "taskkill",
      args: ["/PID", "123", "/T", "/F"],
    });
  });
  it.each(["SIGINT", "SIGTERM", "SIGKILL"] as const)(
    "preserves POSIX group signal %s",
    (signal) => {
      expect(signalPlan({ platform: "linux", pid: 123, signal })).toEqual({
        type: "group",
        pid: -123,
        signal,
      });
    },
  );
});
