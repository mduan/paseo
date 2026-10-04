export const DEFAULT_SSH_DAEMON_PORT = 6767;

export interface SshTransportTarget {
  host: string;
  sshPort?: number;
  daemonPort: number;
}

export function validatePort(value: string | number, label: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be between 1 and 65535`);
  }
  return port;
}

export function validateSshHost(host: string): string {
  const normalized = host.trim();
  if (!normalized) throw new Error("SSH host is required");
  if (/\s/u.test(normalized) || normalized.startsWith("-")) {
    throw new Error("SSH host is invalid");
  }
  return normalized;
}

export function parseSshTransportUri(value: string): SshTransportTarget {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error("Invalid SSH host URI", { cause: error });
  }

  if (url.protocol !== "ssh:" || url.password || (url.pathname !== "" && url.pathname !== "/")) {
    throw new Error("Invalid SSH host URI");
  }
  if (url.hash) throw new Error("SSH host URI does not support fragments");

  for (const key of url.searchParams.keys()) {
    if (key !== "daemonPort") throw new Error(`Unsupported SSH host option: ${key}`);
  }
  const daemonPorts = url.searchParams.getAll("daemonPort");
  if (daemonPorts.length > 1) throw new Error("daemonPort may only be specified once");

  const urlHostname = url.hostname;
  const hostname = validateSshHost(
    urlHostname.startsWith("[") && urlHostname.endsWith("]")
      ? urlHostname.slice(1, -1)
      : urlHostname,
  );
  const username = decodeURIComponent(url.username);
  const host = validateSshHost(username ? `${username}@${hostname}` : hostname);
  return {
    host,
    ...(url.port ? { sshPort: validatePort(url.port, "SSH port") } : {}),
    daemonPort:
      daemonPorts[0] === undefined
        ? DEFAULT_SSH_DAEMON_PORT
        : validatePort(daemonPorts[0], "Daemon port"),
  };
}

function buildSshOptionArgs(target: { sshPort?: number }, options: string[]): string[] {
  const args = ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", ...options];
  if (target.sshPort !== undefined) {
    args.push("-p", String(validatePort(target.sshPort, "SSH port")));
  }
  return args;
}

export function buildSshTunnelArgs(target: SshTransportTarget): string[] {
  const host = validateSshHost(target.host);
  const daemonPort = validatePort(target.daemonPort, "Daemon port");
  return [
    ...buildSshOptionArgs(target, [
      "-o",
      "ClearAllForwardings=yes",
      "-o",
      "ExitOnForwardFailure=yes",
    ]),
    "-W",
    `127.0.0.1:${daemonPort}`,
    host,
  ];
}

/** Runs `command` in a remote bash login shell, so PATH setup from profiles (nvm, fnm) applies. */
export function buildSshCommandArgs(target: {
  host: string;
  sshPort?: number;
  command: string;
}): string[] {
  const host = validateSshHost(target.host);
  const quotedCommand = `'${target.command.replaceAll("'", "'\\''")}'`;
  return [
    ...buildSshOptionArgs(target, ["-o", "ClearAllForwardings=yes"]),
    host,
    `bash -lc ${quotedCommand}`,
  ];
}
