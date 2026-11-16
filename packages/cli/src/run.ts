import { renderError, toCommandError, defaultOutputOptions } from "./output/render.js";
import type { Command } from "commander";
import { classifyInvocation } from "./classify.js";
import { createCliProgram } from "./cli-program.js";
import { createHooksCommand } from "./commands/hooks.js";

export interface RunCliOptions {
  cwd?: string;
  nodeArgv?: [string, string];
}

const DEFAULT_NODE_ARGV: [string, string] = ["paseo", "paseo"];

export async function createCliParseArgv(input: {
  argv: string[];
  cwd: string;
  nodeArgv?: [string, string];
}): Promise<string[] | { kind: "open-project"; resolvedPath: string }> {
  const { createCli } = await import("./cli.js");
  const program = createCli();
  const knownCommands = new Set(program.commands.map((command) => command.name()));
  const invocation = classifyInvocation({
    argv: input.argv,
    knownCommands,
    cwd: input.cwd,
  });

  if (invocation.kind === "open-project") {
    return invocation;
  }

  const nodeArgv = input.nodeArgv ?? DEFAULT_NODE_ARGV;
  const isOnboardRootFlag = invocation.argv[0] === "--relay" || invocation.argv[0] === "--no-relay";
  let cliArgv = invocation.argv;
  if (invocation.argv.length === 0) {
    cliArgv = ["onboard"];
  } else if (isOnboardRootFlag) {
    cliArgv = ["onboard", ...invocation.argv];
  }
  return [...nodeArgv, ...cliArgv];
}

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  // Agent terminal hooks run `paseo hooks …` on every tool call, and Codex
  // PreToolUse blocks until it exits. Skip loading every other command.
  if (argv[0] === "hooks") {
    const program = createCliProgram((root) => root.addCommand(createHooksCommand()));
    return parseCli(program, [...(options.nodeArgv ?? DEFAULT_NODE_ARGV), ...argv], argv);
  }

  const parseArgv = await createCliParseArgv({
    argv,
    cwd: options.cwd ?? process.cwd(),
    nodeArgv: options.nodeArgv,
  });

  if (!Array.isArray(parseArgv)) {
    const { openDesktopWithProject } = await import("./commands/open.js");
    await openDesktopWithProject(parseArgv.resolvedPath);
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  }

  const { createCli } = await import("./cli.js");
  return parseCli(createCli(), parseArgv, argv);
}

async function parseCli(program: Command, parseArgv: string[], argv: string[]): Promise<number> {
  try {
    await program.parseAsync(parseArgv, { from: "node" });
  } catch (error) {
    process.stderr.write(
      renderError(toCommandError(error), {
        ...defaultOutputOptions,
        format: argv.includes("--json") ? "json" : "table",
      }) + "\n",
    );
    return 1;
  }
  return typeof process.exitCode === "number" ? process.exitCode : 0;
}
