import { randomUUID } from "node:crypto";
import { runAcpProvider } from "@getpaseo/plugin/server/acp";
import type {
  ProviderConnection,
  ProviderEvent,
  ProviderInput,
  ProviderLaunch,
  ProviderPermissionResponse,
  ProviderPersistence,
  ProviderPrompt,
  ProviderSessionConfig,
} from "@getpaseo/plugin/server/provider";
import { AntigravityError } from "./errors.js";

interface AcpSessionOptions {
  id: string;
  config: ProviderSessionConfig;
  launch: ProviderLaunch;
  persistence?: ProviderPersistence;
  firstMessage: boolean;
  emit(event: ProviderEvent): void;
}

export class AcpSession {
  private connection?: ProviderConnection;
  private firstMessage: boolean;
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
      if (event.type === "catalog" || event.type === "session.commands") return;
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
      if (event.type === "timeline.item" && event.item.type === "user_message") {
        const text = this.userText.get(event.item.id);
        if (text !== undefined) {
          this.userText.delete(event.item.id);
          event = { ...event, item: { ...event.item, text } };
        }
      }
      this.options.emit(event);
    });
    const catalog = await this.request({
      type: "catalog",
      requestId: randomUUID(),
      cwd: this.options.config.cwd,
    });
    if (catalog.type !== "catalog" || !catalog.catalog.modes.some((entry) => entry.id === mode))
      throw new AntigravityError(
        `Antigravity mode ${this.options.config.mode} is unavailable for this account or host`,
        "UNSUPPORTED_MODE",
      );
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
      history: "skip",
      config: { ...this.options.config, mode },
      persistence,
    });
    this.options.emit({
      type: "session.notice",
      sessionId: this.options.id,
      notice: {
        id: `${this.options.id}:full-access`,
        severity: "warning",
        title: "Antigravity is running with full access",
        description:
          "Full access starts Antigravity with --dangerously-skip-permissions. Every tool call, including shell commands, runs without asking.",
        dismissed: fullAccess ? undefined : true,
      },
    });
  }

  async prompt(prompt: ProviderPrompt): Promise<void> {
    if (
      prompt.input.type !== "message" ||
      prompt.delivery === "steer" ||
      prompt.outputSchema !== undefined
    )
      throw new AntigravityError("Antigravity supports messages only");
    let nativePrompt = prompt;
    if (this.firstMessage && this.options.config.systemPrompt) {
      this.userText.set(
        prompt.clientMessageId,
        prompt.input.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      );
      nativePrompt = {
        ...prompt,
        input: {
          ...prompt.input,
          content: [
            { type: "text", text: this.options.config.systemPrompt },
            ...prompt.input.content,
          ],
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
    await this.connection?.close();
    this.userText.clear();
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
          reject(new AntigravityError(event.error.message));
        } else if (
          event.type === "request.completed" ||
          event.type === "session.ready" ||
          event.type === "catalog" ||
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
