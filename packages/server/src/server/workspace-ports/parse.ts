/* oxlint-disable typescript/consistent-type-definitions -- AGENTS.md requires type aliases. */
import { posix } from "node:path";
import type { WorkspacePort } from "@getpaseo/protocol/messages";

export type ListeningPort = Omit<WorkspacePort, "workspaceId"> & { pid: number };
export type ProcessDetails = { cwd?: string; commandLine?: string; workspaceId?: string };
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

export function parseProcessParents(output: string): Map<number, number> {
  const parents = new Map<number, number>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (match) parents.set(Number(match[1]), Number(match[2]));
  }
  return parents;
}

export function parseProcessWorkspaceIds(output: string): Map<number, string> {
  const workspaceIds = new Map<number, string>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!match) continue;
    const envMatch = /(?:^|\s)PASEO_WORKSPACE_ID=([^\s=]+)(?=\s|$)/.exec(match[2]);
    if (envMatch) workspaceIds.set(Number(match[1]), envMatch[1]);
  }
  return workspaceIds;
}

export function parseProcEnvironWorkspaceId(contents: string): string | undefined {
  for (const entry of contents.split("\0")) {
    if (!entry.startsWith("PASEO_WORKSPACE_ID=")) continue;
    const value = entry.slice("PASEO_WORKSPACE_ID=".length);
    if (value) return value;
  }
  return undefined;
}

export function parseProcStatParent(contents: string): number | undefined {
  const endComm = contents.lastIndexOf(")");
  if (endComm === -1) return undefined;
  const fields = contents
    .slice(endComm + 1)
    .trimStart()
    .split(/\s+/);
  const ppid = Number(fields[1]);
  return Number.isInteger(ppid) && ppid > 0 ? ppid : undefined;
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

type ResolvedPortWorkspace = { workspace: PortWorkspace; resolvedCwd: string };

function matchingWorkspaces(
  deepestFirst: ResolvedPortWorkspace[],
  predicate: (entry: ResolvedPortWorkspace) => boolean,
): PortWorkspace[] {
  const matches = deepestFirst.filter(predicate);
  if (!matches.length) return [];
  const deepestLength = matches[0].resolvedCwd.length;
  return matches
    .filter((entry) => entry.resolvedCwd.length === deepestLength)
    .map((entry) => entry.workspace);
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
  const workspacesById = new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace]));
  const deepestFirst = workspaces
    .map((workspace) => ({ workspace, resolvedCwd: posix.resolve(workspace.cwd) }))
    .sort(
      (a, b) =>
        b.resolvedCwd.length - a.resolvedCwd.length ||
        a.workspace.workspaceId.localeCompare(b.workspace.workspaceId),
    );
  const assigned = new Map<string, WorkspacePort>();
  for (const port of ports) {
    const metadata = details.get(port.pid);
    const explicitWorkspace = metadata?.workspaceId
      ? workspacesById.get(metadata.workspaceId)
      : undefined;
    let targets: PortWorkspace[];
    if (explicitWorkspace) {
      targets = [explicitWorkspace];
    } else {
      const cwd = metadata?.cwd;
      const byCwd = cwd
        ? matchingWorkspaces(deepestFirst, ({ resolvedCwd }) => containsPath(resolvedCwd, cwd))
        : [];
      if (byCwd.length > 0) {
        targets = byCwd;
      } else {
        const commandLine = metadata?.commandLine;
        targets = commandLine
          ? matchingWorkspaces(deepestFirst, ({ resolvedCwd }) =>
              commandContainsPath(commandLine, resolvedCwd),
            )
          : [];
      }
    }
    for (const workspace of targets) {
      assigned.set(`${workspace.workspaceId}:${port.host}:${port.port}:${port.pid}`, {
        ...port,
        workspaceId: workspace.workspaceId,
      });
    }
  }
  return [...assigned.values()].sort(
    (a, b) =>
      a.workspaceId.localeCompare(b.workspaceId) ||
      a.port - b.port ||
      a.host.localeCompare(b.host) ||
      (a.pid ?? 0) - (b.pid ?? 0),
  );
}
