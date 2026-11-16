import { randomUUID } from "node:crypto";
import { runAcpProvider } from "@getpaseo/plugin/server/acp";
import type {
  ProviderConnection,
  ProviderContent,
  ProviderEvent,
  ProviderInput,
  ProviderLaunch,
  ProviderPermissionResponse,
  ProviderPersistence,
  ProviderPrompt,
  ProviderSessionConfig,
  ProviderTimelineItem,
} from "@getpaseo/plugin/server/provider";
import { AntigravityError } from "./errors.js";

interface AcpSessionOptions {
  id: string;
  config: ProviderSessionConfig;
  launch: ProviderLaunch;
  persistence?: ProviderPersistence;
  firstMessage: boolean;
  history: "replay" | "skip";
  emit(event: ProviderEvent): void;
}

const backgroundCheckReply = "PASEO_BACKGROUND_PENDING";
const backgroundCheckPrompt = `Automatic check for the existing background task. Do not start or repeat work or call tools. Preserve any pending background completion report, but do not repeat it. Reply only ${backgroundCheckReply}.`;
const backgroundCheckIntervalMs = 10_000;
const backgroundCheckLimit = 30;
const backgroundTaskNotificationPattern =
  /FINISHED_BACKGROUND_TASK:[^\n]*\r?\n?<task_notification>[\s\S]*?<\/task_notification>(?:\s*<user_guidance>[\s\S]*?<\/user_guidance>)?\s*/g;
const trailingIncompleteGuidancePattern =
  /FINISHED_BACKGROUND_TASK:[^\n]*\r?\n?<task_notification>[\s\S]*?<\/task_notification>\s*<user_guidance>(?![\s\S]*<\/user_guidance>)[\s\S]*$/;
const trailingIncompleteTaskPattern = /FINISHED_BACKGROUND_TASK:[\s\S]*$/;
const backgroundCheckPrefixPattern = new RegExp(`^\\s*${backgroundCheckReply}\\s*`);

export function stripBackgroundArtifacts(text: string, stripCheckReply: boolean): string {
  let cleaned = text
    .replace(trailingIncompleteGuidancePattern, "")
    .replaceAll(backgroundTaskNotificationPattern, "")
    .replace(trailingIncompleteTaskPattern, "");

  if (cleaned === text && !stripCheckReply) return text;
  if (stripCheckReply || cleaned !== text)
    cleaned = cleaned.replace(backgroundCheckPrefixPattern, "");
  return cleaned.trim();
}

// shortcut: agy lists built-ins and skills together with no marker, update when agy adds built-ins.
const BUILTIN_COMMANDS = new Set([
  "goal",
  "compact",
  "schedule",
  "browser",
  "plan",
  "teamwork",
  "learn",
  "boost",
]);

export class AcpSession {
  private connection?: ProviderConnection;
  private firstMessage: boolean;
  private readonly backgroundTools = new Map<
    string,
    Extract<ProviderTimelineItem, { type: "tool_call" }> | undefined
  >();
  private readonly checkMessages = new Map<
    string,
    Extract<ProviderTimelineItem, { type: "assistant_message" }>
  >();
  private checkTimer?: ReturnType<typeof setTimeout>;
  private checkMessageId?: string;
  private checkAttempts = 0;
  private turnId?: string;
  private nativeTurnActive = false;
  private closed = false;
  private readonly userText = new Map<string, string>();

  constructor(private readonly options: AcpSessionOptions) {
    this.firstMessage = options.firstMessage;
  }

  async open(requestId: string, capabilities: readonly string[]): Promise<void> {
    const fullAccess = this.options.config.mode === "full-access";
    const mode = fullAccess ? "default" : this.options.config.mode;
    if (!fullAccess && !capabilities.includes("permission"))
      throw new AntigravityError("Antigravity approval modes require permission-response support");
    if (
      !fullAccess &&
      this.options.launch.args.some((arg) => arg.startsWith("--dangerously-skip-permissions"))
    )
      throw new AntigravityError(
        "Remove --dangerously-skip-permissions from the Antigravity command to use an approval mode",
      );
    const provider = runAcpProvider({
      id: "antigravity",
      label: "Antigravity",
      command: ["agy", "acp"],
      acpOptions: { waitForInitialCommands: true, supportsSteering: true },
      transformers: [
        {
          configure: async (change, context) => {
            if (change.target === "mode" && !context.modeIds.some((id) => id === change.value))
              throw new AntigravityError(
                `Antigravity mode ${this.options.config.mode} is unavailable for this account or host`,
                "UNSUPPORTED_MODE",
              );
            return "pass";
          },
          toolCall: (tool) => {
            if (tool.status === "in_progress")
              this.backgroundTools.set(tool.id, this.backgroundTools.get(tool.id));
            if (tool.status === "completed" || tool.status === "failed")
              this.backgroundTools.delete(tool.id);
            return tool;
          },
        },
      ],
    });
    const connection = await provider.connect({
      versions: [1],
      capabilities,
      launch: {
        ...this.options.launch,
        args: [
          ...this.options.launch.args,
          "acp",
          "--process-per-session",
          ...(fullAccess ? ["--dangerously-skip-permissions"] : []),
        ],
      },
    });
    this.connection = connection;
    connection.onEvent((event) => {
      if (event.type === "session.opened" || event.type === "session.persistence") {
        const persistence = event.persistence;
        if (persistence) {
          const data = persistence.data;
          if (
            !data ||
            typeof data !== "object" ||
            Array.isArray(data) ||
            typeof data.sessionId !== "string"
          )
            throw new AntigravityError("Antigravity ACP did not return a conversation ID");
          event = {
            ...event,
            persistence: { version: 1, data: { conversationId: data.sessionId } },
          };
        }
      }
      if (event.type === "session.commands") {
        event = {
          ...event,
          commands: event.commands.map((command) => ({
            ...command,
            kind: BUILTIN_COMMANDS.has(command.name) ? "command" : "skill",
          })),
        };
      }
      if (event.type === "timeline.item" && event.item.type === "user_message") {
        const text = this.userText.get(event.item.id);
        if (text !== undefined) {
          this.userText.delete(event.item.id);
          event = { ...event, item: { ...event.item, text } };
        }
      }
      this.emit(event);
    });
    let persistence: ProviderPersistence | undefined;
    if (this.options.persistence) {
      const data = this.options.persistence.data;
      if (
        this.options.persistence.version !== 1 ||
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        typeof data.conversationId !== "string" ||
        !data.conversationId
      )
        throw new AntigravityError("Invalid Antigravity conversation persistence");
      persistence = { version: 1, data: { sessionId: data.conversationId } };
    }
    await this.request({
      type: "session.open",
      requestId,
      sessionId: this.options.id,
      history: this.options.history,
      config: { ...this.options.config, mode },
      persistence,
    });
  }

  async prompt(prompt: ProviderPrompt): Promise<void> {
    if (prompt.outputSchema !== undefined)
      throw new AntigravityError("Antigravity does not support structured output");
    clearTimeout(this.checkTimer);
    this.checkAttempts = 0;
    if (prompt.delivery === "steer" && !this.nativeTurnActive)
      prompt = { ...prompt, delivery: "auto" };
    let content: ProviderContent[];
    if (prompt.input.type === "command") {
      const suffix = prompt.input.arguments ? ` ${prompt.input.arguments}` : "";
      content = [{ type: "text", text: `/${prompt.input.name}${suffix}` }];
    } else {
      content = prompt.input.content;
    }
    let nativePrompt: ProviderPrompt = { ...prompt, input: { type: "message", content } };
    if (this.firstMessage && this.options.config.systemPrompt) {
      this.userText.set(
        prompt.clientMessageId,
        content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      );
      nativePrompt = {
        ...nativePrompt,
        input: {
          type: "message",
          content: [{ type: "text", text: this.options.config.systemPrompt }, ...content],
        },
      };
    }
    await this.request({
      type: "session.prompt",
      sessionId: this.options.id,
      prompt: nativePrompt,
    });
    this.firstMessage = false;
  }

  async interrupt(): Promise<void> {
    clearTimeout(this.checkTimer);
    if (!this.nativeTurnActive && this.turnId) {
      this.finishTurn({
        type: "session.turn",
        sessionId: this.options.id,
        turnId: this.turnId,
        state: "canceled",
      });
      return;
    }
    await this.request({
      type: "session.interrupt",
      requestId: randomUUID(),
      sessionId: this.options.id,
    });
  }

  async respondToPermission(
    permissionId: string,
    response: ProviderPermissionResponse,
  ): Promise<void> {
    if (!this.connection) throw new AntigravityError("Antigravity ACP is not connected");
    await this.connection.send({
      type: "session.permission",
      sessionId: this.options.id,
      permissionId,
      response,
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.checkTimer);
    this.backgroundTools.clear();
    this.checkMessages.clear();
    await this.connection?.close();
    this.userText.clear();
  }

  private emit(event: ProviderEvent): void {
    if (this.closed) return;
    if (event.type === "timeline.item") {
      const item = this.filterTimelineItem(event.item);
      if (!item) return;
      if (item !== event.item) event = { ...event, item };
    }
    if (event.type === "session.prompt_result") {
      if (event.clientMessageId === this.checkMessageId) return;
      if (this.turnId && event.result.type === "turn")
        event = { ...event, result: { type: "steer", turnId: this.turnId } };
    }
    if (event.type === "session.usage" && this.turnId) event = { ...event, turnId: this.turnId };
    if (event.type === "session.runtime_failed") {
      clearTimeout(this.checkTimer);
      this.backgroundTools.clear();
      this.flushCheckMessages();
      this.turnId = undefined;
      this.nativeTurnActive = false;
    }
    if (event.type === "session.turn") {
      this.handleTurn(event);
      return;
    }
    this.options.emit(event);
  }

  private filterTimelineItem(item: ProviderTimelineItem): ProviderTimelineItem | undefined {
    if (
      item.type === "user_message" &&
      (item.id === this.checkMessageId || item.text.trim() === backgroundCheckPrompt)
    )
      return undefined;
    if (item.type === "tool_call" && this.backgroundTools.has(item.callId)) {
      if (item.status === "running") this.backgroundTools.set(item.callId, item);
      // ACP terminalizes tools at end_turn even when agy still has background work.
      if (item.status === "completed") return undefined;
    }
    if (item.type === "assistant_message") {
      if (this.checkMessageId) {
        this.checkMessages.set(item.id, item);
        return undefined;
      }
      const cleaned = stripBackgroundArtifacts(item.text, false);
      if (cleaned !== item.text) return cleaned ? { ...item, text: cleaned } : undefined;
    }
    return item;
  }

  private handleTurn(event: Extract<ProviderEvent, { type: "session.turn" }>): void {
    this.nativeTurnActive = event.state === "started";
    if (event.state === "started") {
      if (this.turnId) return;
      this.turnId = event.turnId;
    } else {
      this.flushCheckMessages();
      this.checkMessageId = undefined;
      if (event.state === "completed" && this.backgroundTools.size) {
        if (this.checkAttempts < backgroundCheckLimit) {
          this.checkTimer = setTimeout(
            () => void this.checkBackground(),
            backgroundCheckIntervalMs,
          );
          return;
        }
        event = {
          ...event,
          state: "failed",
          error: {
            message:
              "Background checks stopped after 30 attempts. Send a message to check the task again.",
          },
        };
      }
      this.finishTurn(event);
      return;
    }
    this.options.emit(event);
  }

  private flushCheckMessages(): void {
    for (const item of this.checkMessages.values()) {
      const text = stripBackgroundArtifacts(item.text, true);
      if (text)
        this.options.emit({
          type: "timeline.item",
          sessionId: this.options.id,
          item: text === item.text ? item : { ...item, text },
        });
    }
    this.checkMessages.clear();
  }

  private finishTurn(event: Extract<ProviderEvent, { type: "session.turn" }>): void {
    for (const item of this.backgroundTools.values()) {
      if (!item) continue;
      const terminalItem: Extract<ProviderTimelineItem, { type: "tool_call" }> =
        event.state === "canceled"
          ? { ...item, status: "canceled", error: null }
          : {
              ...item,
              status: "failed",
              error: { message: event.error?.message ?? "Background task status is unknown" },
            };
      this.options.emit({ type: "timeline.item", sessionId: this.options.id, item: terminalItem });
    }
    this.options.emit({ ...event, turnId: this.turnId ?? event.turnId });
    this.turnId = undefined;
    this.backgroundTools.clear();
  }

  private async checkBackground(): Promise<void> {
    if (this.closed || this.nativeTurnActive || !this.backgroundTools.size) return;
    this.checkAttempts++;
    this.checkMessageId = randomUUID();
    try {
      await this.request({
        type: "session.prompt",
        sessionId: this.options.id,
        prompt: {
          clientMessageId: this.checkMessageId,
          delivery: "auto",
          input: {
            type: "message",
            content: [
              {
                type: "text",
                text: backgroundCheckPrompt,
              },
            ],
          },
        },
      });
    } catch (error) {
      this.flushCheckMessages();
      this.checkMessageId = undefined;
      if (!this.closed && this.turnId)
        this.finishTurn({
          type: "session.turn",
          sessionId: this.options.id,
          turnId: this.turnId,
          state: "failed",
          error: { message: error instanceof Error ? error.message : String(error) },
        });
    }
  }

  private async request(input: ProviderInput): Promise<ProviderEvent> {
    const connection = this.connection;
    if (!connection) throw new AntigravityError("Antigravity ACP is not connected");
    return new Promise((resolve, reject) => {
      const unsubscribe = connection.onEvent((event) => {
        const matchesRequest =
          "requestId" in input && "requestId" in event && input.requestId === event.requestId;
        const matchesPrompt =
          input.type === "session.prompt" &&
          event.type === "session.prompt_result" &&
          input.prompt.clientMessageId === event.clientMessageId;
        if (!matchesRequest && !matchesPrompt) return;
        if (event.type === "request.failed") {
          unsubscribe();
          reject(new AntigravityError(event.error.message, event.error.code));
        } else if (
          event.type === "request.completed" ||
          event.type === "session.ready" ||
          event.type === "session.prompt_result"
        ) {
          unsubscribe();
          if (event.type === "session.prompt_result" && event.result.type === "failed")
            reject(new AntigravityError(event.result.error.message));
          else resolve(event);
        }
      });
      void connection.send(input).catch((error) => {
        unsubscribe();
        reject(error);
      });
    });
  }
}
