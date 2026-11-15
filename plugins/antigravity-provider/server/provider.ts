import { createHash } from "node:crypto";
import {
  negotiateProviderCapabilities,
  requireProviderCapabilities,
  type ProviderCatalog,
  type ProviderConnection,
  type ProviderEvent,
  type ProviderInput,
  type ProviderLaunch,
  type ProviderRegistration,
  type ProviderPersistence,
  type ProviderSessionConfig,
} from "@getpaseo/plugin/server/provider";
import { getCatalog, getStatus, validateSelection } from "./internal/catalog.js";
import { AcpSession } from "./internal/acp-session.js";
import { selection } from "./internal/process.js";
import { AntigravityError } from "./internal/errors.js";

const capabilities = [
  "prompt.message",
  "prompt.command",
  "prompt.image",
  "prompt.steer",
  "session.configure",
  "session.persistence",
  "permission",
] as const;

interface OpenSession {
  backend?: AcpSession;
  config: ProviderSessionConfig;
  persistence?: ProviderPersistence;
  active: boolean;
  firstMessage: boolean;
  backendSelection?: string;
  fullAccessNoticeShown?: boolean;
}

export function createAntigravityProvider(): ProviderRegistration {
  return {
    id: "antigravity",
    label: "Antigravity",
    icon: "icon.svg",
    command: ["agy"],
    description: "Antigravity CLI on your host",
    async status({ launch }) {
      if (!launch)
        return {
          available: false,
          diagnostic: "agy not found on PATH. Install Antigravity, then run `agy` and sign in.",
        };
      return getStatus(launch);
    },
    async getCatalogCacheKey({ launch }) {
      if (!launch) return undefined;
      const env = Object.entries(launch.env).sort(([left], [right]) => left.localeCompare(right));
      return createHash("sha256")
        .update(JSON.stringify([launch.command, launch.args, env]))
        .digest("hex");
    },
    async connect(request) {
      if (!request.versions.includes(1))
        throw new AntigravityError("Provider protocol version 1 is required");
      if (!request.launch)
        throw new AntigravityError("The daemon must supply the Antigravity launch");
      const negotiated = negotiateProviderCapabilities(request.capabilities, capabilities);
      return createConnection(request.launch, negotiated);
    },
  };
}

function createConnection(
  launch: ProviderLaunch,
  negotiated: readonly string[],
): ProviderConnection {
  const sessions = new Map<string, OpenSession>();
  const listeners = new Set<(event: ProviderEvent) => void>();
  let discovered: ProviderCatalog | null = null;
  let closed = false;
  let pending = Promise.resolve();

  function emit(event: ProviderEvent): void {
    if (closed) return;
    if ("sessionId" in event) {
      const opened = sessions.get(event.sessionId);
      if (opened) {
        if (event.type === "session.opened" || event.type === "session.persistence")
          opened.persistence = event.persistence;
        if (event.type === "session.turn") opened.active = event.state === "started";
        if (event.type === "session.runtime_failed") opened.active = false;
        if (!opened.config.persist) {
          if (event.type === "session.persistence") return;
          if (event.type === "session.opened") event = { ...event, persistence: undefined };
        }
        if (
          event.type === "session.notice" &&
          event.notice.id === `${event.sessionId}:full-access`
        ) {
          if (!event.notice.dismissed && opened.fullAccessNoticeShown) return;
          opened.fullAccessNoticeShown = !event.notice.dismissed;
        }
        if (event.type === "session.config") {
          opened.config.model = event.config.model;
          opened.config.thinkingOption = event.config.thinkingOption;
          event = {
            ...event,
            config: {
              ...event.config,
              mode: opened.config.mode,
              models: catalog().models,
              modes: catalog().modes,
              settings: [],
            },
          };
        }
      }
    }
    for (const listener of listeners) listener(event);
  }
  function catalog(): ProviderCatalog {
    if (discovered === null)
      throw new AntigravityError("Antigravity catalog has not been discovered");
    return discovered;
  }
  function session(id: string): OpenSession {
    const found = sessions.get(id);
    if (!found) throw new AntigravityError(`Unknown Antigravity session: ${id}`);
    return found;
  }
  async function startSession(
    id: string,
    opened: OpenSession,
    requestId: string,
    restoring = false,
  ): Promise<void> {
    await opened.backend?.close();
    const backend = new AcpSession({
      id,
      config: opened.config,
      persistence: opened.persistence,
      firstMessage: opened.firstMessage,
      launch,
      emit(event) {
        if (restoring && (event.type === "session.opened" || event.type === "session.ready")) {
          if (event.type === "session.opened") opened.persistence = event.persistence;
          return;
        }
        emit(event);
      },
    });
    opened.backend = backend;
    opened.backendSelection = undefined;
    try {
      await backend.open(requestId, negotiated);
      opened.backendSelection = selection(opened.config);
    } catch (error) {
      await backend.close();
      opened.backend = undefined;
      throw error;
    }
  }
  function configureSession(input: Extract<ProviderInput, { type: "session.configure" }>): void {
    const opened = session(input.sessionId);
    const config = {
      ...opened.config,
      model:
        input.changes.model === null ? undefined : (input.changes.model ?? opened.config.model),
      mode:
        input.changes.mode === null ? "full-access" : (input.changes.mode ?? opened.config.mode),
      thinkingOption:
        input.changes.thinkingOption === null
          ? undefined
          : (input.changes.thinkingOption ?? opened.config.thinkingOption),
    };
    const modelChanged =
      input.changes.model !== undefined && input.changes.model !== opened.config.model;
    if (modelChanged && input.changes.thinkingOption === undefined) {
      const model = catalog().models.find((entry) => entry.id === config.model);
      if (!model?.thinkingOptions?.some((option) => option.id === config.thinkingOption))
        config.thinkingOption = undefined;
    }
    validateSelection(config, catalog());
    if (input.changes.settings && Object.keys(input.changes.settings).length)
      throw new AntigravityError("Antigravity has no configurable settings");
    opened.config = config;
    emit({
      type: "session.config",
      sessionId: input.sessionId,
      config: {
        model: config.model,
        thinkingOption: config.thinkingOption,
        mode: config.mode,
        modes: catalog().modes,
        models: catalog().models,
        settings: [],
        thinkingOptions:
          catalog().models.find((model) => model.id === config.model)?.thinkingOptions ?? [],
      },
    });
  }
  async function promptSession(
    input: Extract<ProviderInput, { type: "session.prompt" }>,
  ): Promise<void> {
    const opened = session(input.sessionId);
    const steering = input.prompt.delivery === "steer";
    if (opened.active && !steering)
      throw new AntigravityError("Antigravity already has an active turn", "TURN_ACTIVE");
    if (!steering && opened.backendSelection !== selection(opened.config))
      await startSession(input.sessionId, opened, `restore-${input.prompt.clientMessageId}`, true);
    if (!opened.backend) throw new AntigravityError("Antigravity session is not ready");
    await opened.backend.prompt(input.prompt);
    opened.firstMessage = false;
  }
  async function dispatch(input: ProviderInput): Promise<void> {
    switch (input.type) {
      case "catalog":
        discovered = await getCatalog(launch, input.cwd);
        emit({
          type: "catalog",
          requestId: input.requestId,
          catalog: catalog(),
        });
        return;
      case "session.open": {
        if (sessions.has(input.sessionId))
          throw new AntigravityError(`Session already exists: ${input.sessionId}`);
        if (discovered === null) discovered = await getCatalog(launch, input.config.cwd);
        const config = { ...input.config, mode: input.config.mode ?? "full-access" };
        validateSelection(config, catalog());
        const opened: OpenSession = {
          config,
          persistence: input.persistence,
          active: false,
          firstMessage: !input.persistence,
        };
        sessions.set(input.sessionId, opened);
        try {
          await startSession(input.sessionId, opened, input.requestId);
        } catch (error) {
          sessions.delete(input.sessionId);
          await opened.backend?.close();
          throw error;
        }
        return;
      }
      case "session.prompt": {
        await promptSession(input);
        return;
      }
      case "session.configure":
        configureSession(input);
        break;
      case "session.permission": {
        const backend = session(input.sessionId).backend;
        if (!backend) throw new AntigravityError("Antigravity session is not ready");
        await backend.respondToPermission(input.permissionId, input.response);
        return;
      }
      case "session.interrupt":
        await session(input.sessionId).backend?.interrupt();
        break;
      case "session.close": {
        await session(input.sessionId).backend?.close();
        sessions.delete(input.sessionId);
        emit({ type: "session.closed", sessionId: input.sessionId });
        break;
      }
      default:
        throw new AntigravityError(`Unsupported Antigravity operation: ${input.type}`);
    }
    emit({ type: "request.completed", requestId: input.requestId });
  }
  function failed(input: ProviderInput, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof AntigravityError ? error.code : "ANTIGRAVITY_ERROR";
    if (input.type === "session.prompt")
      emit({
        type: "session.prompt_result",
        sessionId: input.sessionId,
        clientMessageId: input.prompt.clientMessageId,
        result: { type: "failed", error: { message, code } },
      });
    else if ("requestId" in input)
      emit({ type: "request.failed", requestId: input.requestId, error: { message, code } });
  }
  return {
    version: 1,
    capabilities: negotiated,
    async send(input) {
      if (closed) throw new AntigravityError("Antigravity connection is closed");
      requireProviderCapabilities(negotiated, input);
      pending = pending
        .then(async () => {
          if (!closed) await dispatch(input);
          return undefined;
        })
        .catch((error) => failed(input, error));
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      if (closed) return;
      closed = true;
      await pending;
      await Promise.all([...sessions.values()].map((opened) => opened.backend?.close()));
      sessions.clear();
      listeners.clear();
    },
  };
}
