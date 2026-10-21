import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve as resolvePath } from "node:path";
import { PASEO_CLI_PACKAGE } from "../server/session/daemon/npm-global-cli.js";

const require = createRequire(import.meta.url);
// The fork publishes the CLI as `@mduan/paseo-cli` with this server bundled
// inside it; local dev and the desktop app resolve the `@getpaseo/cli` workspace.
// The fork name goes first so a leftover global `@getpaseo/cli` never wins.
const PASEO_CLI_BIN_ENTRIES = [`${PASEO_CLI_PACKAGE}/bin/paseo`, "@getpaseo/cli/bin/paseo"];

export function resolveExternalProcessPath(filePath: string): string {
  return filePath.replace(/\.asar(?=[/\\]|$)/, ".asar.unpacked");
}

export function resolvePaseoCliBinDir(): string | null {
  const cliExecutable = resolvePaseoCliExecutablePath();
  return cliExecutable ? dirname(cliExecutable) : null;
}

export function resolvePaseoCliExecutablePath(): string | null {
  const configuredCli = process.env.PASEO_CLI?.trim();
  if (configuredCli) {
    return resolvePath(configuredCli);
  }

  const cliEntrypoint = resolvePaseoCliBinEntrypoint();
  if (!cliEntrypoint) {
    return null;
  }

  const externalCliEntrypoint = resolveExternalProcessPath(cliEntrypoint);
  const npmBinDir = findNpmBinDir(dirname(externalCliEntrypoint));
  if (npmBinDir) {
    const shim = resolvePaseoCliShim(npmBinDir);
    if (shim) {
      return shim;
    }
  }

  return externalCliEntrypoint;
}

function resolvePaseoCliBinEntrypoint(): string | null {
  for (const entry of PASEO_CLI_BIN_ENTRIES) {
    try {
      return require.resolve(entry);
    } catch {
      // Try the next package name.
    }
  }
  return null;
}

function findNpmBinDir(startPath: string): string | null {
  let current = startPath;
  while (true) {
    const candidate = join(current, "node_modules", ".bin");
    if (hasPaseoCliShim(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function hasPaseoCliShim(binDir: string): boolean {
  return resolvePaseoCliShim(binDir) !== null;
}

function resolvePaseoCliShim(binDir: string): string | null {
  for (const name of paseoCliShimNames()) {
    const candidate = join(binDir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function paseoCliShimNames(): string[] {
  return process.platform === "win32" ? ["paseo.cmd", "paseo.exe", "paseo"] : ["paseo"];
}

export function prependPaseoCliToPath({
  env,
  cliBinDir,
}: {
  env: Record<string, string>;
  cliBinDir: string | null;
}): Record<string, string> {
  if (!cliBinDir) {
    return env;
  }

  const pathKey = getPathEnvKey(env);
  const currentPath = env[pathKey] ?? "";
  return {
    ...env,
    [pathKey]: prependPathEntry(currentPath, cliBinDir),
  };
}

export function getPathEnvKey(env: Record<string, string>): string {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}

function prependPathEntry(currentPath: string, entry: string): string {
  const entries = currentPath.split(delimiter).filter((value) => value && value !== entry);
  return [entry, ...entries].join(delimiter);
}
