/* oxlint-disable typescript/consistent-type-definitions -- AGENTS.md requires type aliases. */
import { posix } from "node:path";
import type { WorkspacePort } from "@getpaseo/protocol/messages";

export type ListeningPort = Omit<WorkspacePort, "workspaceId"> & { pid: number };
export type ProcessDetails = { cwd?: string; commandLine?: string };
export type PortWorkspace = { workspaceId: string; cwd: string };
export type ProcSocket = { host: string; port: number; inode: string };

export function parseLsofListeners(output: string): ListeningPort[] {
  const ports: ListeningPort[] = [];
  let pid = 0;
  let processName: string | undefined;
  for (const line of output.split("\n")) {
    const value = line.slice(1);
    if (line.startsWith("p")) {
      pid = Number(value);
      processName = undefined;
    } else if (line.startsWith("c")) {
      processName = value;
    } else if (line.startsWith("n") && pid > 0) {
      const match = /^(?:\[([^\]]+)\]|(.+)):(\d+)$/.exec(value);
      if (!match) continue;
      const port = Number(match[3]);
      if (port > 0 && port <= 65535) {
        ports.push({ pid, processName, host: match[1] ?? match[2], port });
      }
    }
  }
  return ports;
}

export function parseLsofCwds(output: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid = 0;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid > 0) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

export function parseProcessCommands(output: string): Map<number, string> {
  const commands = new Map<number, string>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (match) commands.set(Number(match[1]), match[2]);
  }
  return commands;
}

function decodeProcAddress(hex: string): string | undefined {
  if (!/^(?:[\dA-Fa-f]{8}|[\dA-Fa-f]{32})$/.test(hex)) return undefined;
  const bytes = Buffer.from(hex, "hex");
  bytes.swap32();
  if (bytes.length === 4) return [...bytes].join(".");
  const groups: string[] = [];
  for (let index = 0; index < bytes.length; index += 2) {
    groups.push(bytes.readUInt16BE(index).toString(16));
  }
  // URL normalizes the IPv6 zero runs, including the all-zero wildcard address.
  return new URL(`http://[${groups.join(":")}]`).hostname.slice(1, -1);
}

export function parseProcSockets(output: string): ProcSocket[] {
  const sockets: ProcSocket[] = [];
  for (const line of output.trim().split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields[3] !== "0A" || fields.length < 10) continue;
    const [address, portHex] = fields[1].split(":");
    const host = decodeProcAddress(address);
    const port = Number.parseInt(portHex, 16);
    if (host && port > 0 && port <= 65535 && /^\d+$/.test(fields[9])) {
      sockets.push({ host, port, inode: fields[9] });
    }
  }
  return sockets;
}

function containsPath(root: string, cwd: string): boolean {
  const relative = posix.relative(root, cwd);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith("../") && !posix.isAbsolute(relative))
  );
}

function commandContainsPath(command: string, root: string): boolean {
  let index = command.indexOf(root);
  while (index !== -1) {
    const before = command[index - 1];
    const after = command[index + root.length];
    const startsPath = !before || /[\s='"]/.test(before);
    const endsPath = !after || /[\s/'"]/.test(after);
    if (startsPath && endsPath) return true;
    index = command.indexOf(root, index + 1);
  }
  return false;
}

export function assignWorkspacePorts({
  ports,
  details,
  workspaces,
}: {
  ports: ListeningPort[];
  details: ReadonlyMap<number, ProcessDetails>;
  workspaces: PortWorkspace[];
}): WorkspacePort[] {
  const deepestFirst = [...workspaces].sort(
    (a, b) => b.cwd.length - a.cwd.length || a.workspaceId.localeCompare(b.workspaceId),
  );
  const assigned = new Map<string, WorkspacePort>();
  for (const port of ports) {
    const metadata = details.get(port.pid);
    const cwd = metadata?.cwd;
    const byCwd = cwd
      ? deepestFirst.find((workspace) => containsPath(workspace.cwd, cwd))
      : undefined;
    const workspace =
      byCwd ??
      deepestFirst.find(
        (candidate) =>
          metadata?.commandLine && commandContainsPath(metadata.commandLine, candidate.cwd),
      );
    if (!workspace) continue;
    assigned.set(`${port.host}:${port.port}:${port.pid}`, {
      ...port,
      workspaceId: workspace.workspaceId,
    });
  }
  return [...assigned.values()].sort(
    (a, b) =>
      a.workspaceId.localeCompare(b.workspaceId) ||
      a.port - b.port ||
      a.host.localeCompare(b.host) ||
      (a.pid ?? 0) - (b.pid ?? 0),
  );
}
