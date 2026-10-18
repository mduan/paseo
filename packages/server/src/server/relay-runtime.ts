import type pino from "pino";
import type { KeyPair } from "@getpaseo/relay/e2ee";
import type { ExternalSocketMetadata } from "./websocket-server.js";
import {
  startRelayTransport,
  type RelaySocketLike,
  type RelayTransportController,
} from "./relay-transport.js";

export interface RelayRuntimeConfig {
  enabled: boolean;
  endpoint: string;
  publicEndpoint: string;
  useTls: boolean;
  publicUseTls: boolean;
}

interface RelayRuntimeOptions {
  config: RelayRuntimeConfig;
  logger: pino.Logger;
  attachSocket(ws: RelaySocketLike, metadata?: ExternalSocketMetadata): Promise<void>;
  serverId: string;
  daemonKeyPair: KeyPair;
  startTransport?: typeof startRelayTransport;
}

export interface RelayRuntime {
  getConfig(): RelayRuntimeConfig;
  setEnabled(enabled: boolean): void;
  /** Swaps the keypair and reconnects, dropping every relay client paired with the old key. */
  setDaemonKeyPair(keyPair: KeyPair): Promise<void>;
  stop(): Promise<void>;
}

export function createRelayRuntime(options: RelayRuntimeOptions): RelayRuntime {
  const startTransport = options.startTransport ?? startRelayTransport;
  let config = options.config;
  let daemonKeyPair = options.daemonKeyPair;
  let transport: RelayTransportController | null = null;

  function start(): void {
    if (transport) return;
    transport = startTransport({
      logger: options.logger,
      attachSocket: options.attachSocket,
      relayEndpoint: config.endpoint,
      relayUseTls: config.useTls,
      serverId: options.serverId,
      daemonKeyPair,
    });
  }

  function setEnabled(enabled: boolean): void {
    if (config.enabled === enabled) return;
    if (enabled) {
      start();
      config = { ...config, enabled: true };
      return;
    }
    config = { ...config, enabled: false };
    const current = transport;
    transport = null;
    void current?.stop().catch((error) => {
      options.logger.warn({ err: error }, "Failed to stop relay transport");
    });
  }

  async function stop(): Promise<void> {
    const current = transport;
    transport = null;
    await current?.stop();
  }

  async function setDaemonKeyPair(keyPair: KeyPair): Promise<void> {
    daemonKeyPair = keyPair;
    if (!transport) return;
    // Let the old control connection close before the relay sees a new one for the same serverId.
    await stop();
    if (config.enabled) start();
  }

  if (config.enabled) start();

  return {
    getConfig: () => config,
    setEnabled,
    setDaemonKeyPair,
    stop,
  };
}
