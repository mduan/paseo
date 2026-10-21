import { readdir, readFile, readlink } from "node:fs/promises";
import pLimit from "p-limit";
import type { Logger } from "pino";
import { execCommand } from "../../utils/spawn.js";
import {
  parseLsofListeners,
  parseLsofCwds,
  parseProcessCommands,
  parseProcSockets,
  type ListeningPort,
  type ProcessDetails,
} from "./parse.js";

const COMMAND_OPTIONS = { timeout: 5000, maxBuffer: 8 * 1024 * 1024 };

function isMissingProcess(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    ["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(String(error.code))
  );
}

async function readProcess<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    // Processes can exit during the scan, and other users' descriptors may be private.
    if (isMissingProcess(error)) return undefined;
    throw error;
  }
}

async function scanMac(details: Map<number, ProcessDetails>): Promise<ListeningPort[]> {
  const { stdout } = await execCommand(
    "lsof",
    ["-b", "-w", "-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"],
    COMMAND_OPTIONS,
  );
  const ports = parseLsofListeners(stdout);
  const newPids = [...new Set(ports.map((port) => port.pid))].filter((pid) => !details.has(pid));
  if (!newPids.length) return ports;
  const pids = newPids.join(",");
  const [cwdOutput, commandOutput] = await Promise.all([
    execCommand("lsof", ["-b", "-w", "-a", "-p", pids, "-d", "cwd", "-Fn"], COMMAND_OPTIONS),
    execCommand("ps", ["-p", pids, "-o", "pid=", "-o", "command="], COMMAND_OPTIONS),
  ]);
  const cwds = parseLsofCwds(cwdOutput.stdout);
  const commands = parseProcessCommands(commandOutput.stdout);
  for (const pid of newPids) {
    details.set(pid, { cwd: cwds.get(pid), commandLine: commands.get(pid) });
  }
  return ports;
}

async function readDescriptor(link: string): Promise<string | undefined> {
  return readProcess(() => readlink(link));
}

async function scanLinux(details: Map<number, ProcessDetails>): Promise<ListeningPort[]> {
  const [tcp, tcp6, entries] = await Promise.all([
    readFile("/proc/net/tcp", "utf8"),
    readProcess(() => readFile("/proc/net/tcp6", "utf8")),
    readdir("/proc"),
  ]);
  const sockets = [...parseProcSockets(tcp), ...parseProcSockets(tcp6 ?? "")];
  const byInode = new Map(sockets.map((socket) => [socket.inode, socket]));
  const limit = pLimit(16);
  const processes = entries.filter((entry) => /^\d+$/.test(entry));
  const results = await Promise.all(
    processes.map((entry) =>
      limit(async () => {
        const root = `/proc/${entry}`;
        const fds = await readProcess(() => readdir(`${root}/fd`));
        if (!fds) return [];
        const links = await Promise.all(fds.map((fd) => readDescriptor(`${root}/fd/${fd}`)));
        const owned = links.flatMap((link) => {
          const match = link && /^socket:\[(\d+)\]$/.exec(link);
          const socket = match ? byInode.get(match[1]) : undefined;
          return socket ? [socket] : [];
        });
        if (!owned.length) return [];
        const pid = Number(entry);
        const name = await readProcess(() => readFile(`${root}/comm`, "utf8"));
        if (!details.has(pid)) {
          const [cwd, cmdline] = await Promise.all([
            readProcess(() => readlink(`${root}/cwd`)),
            readProcess(() => readFile(`${root}/cmdline`, "utf8")),
          ]);
          details.set(pid, { cwd, commandLine: cmdline?.replaceAll("\0", " ") });
        }
        return owned.map(({ host, port }) => ({ host, port, pid, processName: name?.trim() }));
      }),
    ),
  );
  return results.flat();
}

export async function scanListeningPorts({
  details,
  logger,
}: {
  details: Map<number, ProcessDetails>;
  logger: Logger;
}): Promise<ListeningPort[]> {
  try {
    let ports: ListeningPort[] = [];
    if (process.platform === "darwin") ports = await scanMac(details);
    else if (process.platform === "linux") ports = await scanLinux(details);
    const pids = new Set(ports.map((port) => port.pid));
    for (const pid of details.keys()) if (!pids.has(pid)) details.delete(pid);
    return ports;
  } catch (error) {
    logger.warn({ err: error }, "Workspace port scan failed");
    details.clear();
    return [];
  }
}
