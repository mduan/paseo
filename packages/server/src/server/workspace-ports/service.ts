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
  onChange: (workspaceIds: string[]) => Promise<void>;
  scan?: (details: Map<number, ProcessDetails>) => Promise<ListeningPort[]>;
};

export class WorkspacePortsService {
  private active = false;
  private disposed = false;
  private running = false;
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
    if (connected && !this.running) void this.refresh();
  }

  dispose(): void {
    this.setConnected(false);
    this.disposed = true;
    this.details.clear();
  }

  private async refresh(): Promise<void> {
    this.running = true;
    try {
      const scan =
        this.options.scan ??
        ((details) => scanListeningPorts({ details, logger: this.options.logger }));
      const ports = await scan(this.details);
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
      this.running = false;
      if (this.active) {
        this.timer = setTimeout(() => void this.refresh(), 30_000);
        this.timer.unref();
      }
    }
  }
}
