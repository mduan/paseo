/* oxlint-disable typescript/consistent-type-definitions -- AGENTS.md requires type aliases. */
import type { Logger } from "pino";
import type { WorkspacePort } from "@getpaseo/protocol/messages";
import {
  assignWorkspacePorts,
  type ListeningPort,
  type PortWorkspace,
  type ProcessDetails,
} from "./parse.js";
import { scanListeningPorts } from "./scan.js";

type Options = {
  logger: Logger;
  listWorkspaces: () => Promise<PortWorkspace[]>;
  listProcessOwners?: () => Promise<ReadonlyMap<number, string>>;
  onChange: (workspaceIds: string[]) => Promise<void>;
  scan?: (
    details: Map<number, ProcessDetails>,
    processOwners?: ReadonlyMap<number, string>,
  ) => Promise<ListeningPort[]>;
};

export class WorkspacePortsService {
  private active = false;
  private disposed = false;
  private pending?: Promise<void>;
  private lastScanAt?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly details = new Map<number, ProcessDetails>();
  private ports: WorkspacePort[] = [];
  private byWorkspace = new Map<string, WorkspacePort[]>();

  constructor(private readonly options: Options) {}

  getPorts(workspaceId: string): WorkspacePort[] {
    return this.byWorkspace.get(workspaceId) ?? [];
  }

  setConnected(connected: boolean): void {
    if (this.disposed || this.active === connected) return;
    this.active = connected;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (connected && !this.pending) void this.startRefresh();
  }

  dispose(): void {
    this.setConnected(false);
    this.disposed = true;
    this.details.clear();
  }

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.pending) return this.pending;
    // Hovering across rows must not launch a host-wide process scan for every row.
    if (this.lastScanAt !== undefined && Date.now() - this.lastScanAt < 5_000)
      return Promise.resolve();
    return this.startRefresh();
  }

  private startRefresh(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = this.scan().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async scan(): Promise<void> {
    try {
      const processOwners = this.options.listProcessOwners
        ? await this.options.listProcessOwners()
        : undefined;
      const scan =
        this.options.scan ??
        ((details, owners) =>
          scanListeningPorts({ details, logger: this.options.logger, processOwners: owners }));
      const ports = await scan(this.details, processOwners);
      const workspaces = await this.options.listWorkspaces();
      const next = assignWorkspacePorts({ ports, details: this.details, workspaces });
      if (JSON.stringify(next) !== JSON.stringify(this.ports)) {
        const previous = this.byWorkspace;
        this.ports = next;
        this.byWorkspace = new Map();
        for (const port of next) {
          const group = this.byWorkspace.get(port.workspaceId) ?? [];
          group.push(port);
          this.byWorkspace.set(port.workspaceId, group);
        }
        const workspaceIds = new Set([...previous.keys(), ...this.byWorkspace.keys()]);
        const changedIds = [...workspaceIds].filter(
          (id) => JSON.stringify(previous.get(id)) !== JSON.stringify(this.byWorkspace.get(id)),
        );
        if (this.active) await this.options.onChange(changedIds);
      }
    } catch (error) {
      this.options.logger.warn({ err: error }, "Failed to publish workspace ports");
    } finally {
      this.lastScanAt = Date.now();
      if (this.active) {
        this.timer = setTimeout(() => void this.startRefresh(), 30_000);
        this.timer.unref();
      }
    }
  }
}
