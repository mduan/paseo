import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

export enum AuthMode {
  VirtualKey = "virtual-key",
  Google = "gcloud",
}

const baseSchema = z.object({
  baseUrl: z.url().refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }),
  teamId: z.string().min(1).optional(),
});
const configSchema = z.discriminatedUnion("authMode", [
  baseSchema.extend({ authMode: z.literal(AuthMode.VirtualKey), apiKey: z.string().min(1) }),
  baseSchema.extend({ authMode: z.literal(AuthMode.Google) }),
]);
export type Config = z.infer<typeof configSchema>;

// oxlint-disable-next-line typescript/consistent-type-definitions -- AGENTS.md requires type aliases.
type ConfigLookup = {
  home?: string;
  env?: NodeJS.ProcessEnv;
};

export function configPath({ home = homedir(), env = process.env }: ConfigLookup = {}): string {
  function expand(path: string): string {
    if (path === "~") return home;
    return path.startsWith("~/") ? join(home, path.slice(2)) : resolve(path);
  }
  if (env.LITELLM_CONFIG_PATH?.trim()) return expand(env.LITELLM_CONFIG_PATH.trim());
  const directory = env.PI_CODING_AGENT_DIR?.trim();
  return join(directory ? expand(directory) : join(home, ".pi", "agent"), "litellm-proxy.json");
}

export async function readConfig(path: string): Promise<Config | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new Error("Cannot read LiteLLM configuration", { cause: error });
  }
  try {
    return configSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("Invalid LiteLLM configuration: check baseUrl and authMode");
  }
}

const execFileAsync = promisify(execFile);

export async function googleToken(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gcloud", ["auth", "print-identity-token"], {
      timeout: 15_000,
      maxBuffer: 64 * 1024,
    });
    const token = stdout.trim();
    if (token) return token;
  } catch {
    // Child-process errors can contain credentials in stdout or stderr.
  }
  throw new Error("Cannot obtain LiteLLM Google identity token; run gcloud auth login on the host");
}
