import { Command } from "commander";
import { addDaemonHostOption } from "./utils/command-options.js";
import { resolveCliVersion } from "./version.js";

const VERSION = resolveCliVersion();

// No command imports — the `hooks` fast path in run.ts builds this program without loading every command.
export function createCliProgram(registerCommands: (program: Command) => void): Command {
  const program = new Command();

  program
    .name("paseo")
    .description("Paseo CLI - control your AI coding agents from the command line")
    .version(VERSION, "-v, --version", "output the version number")
    // Global output options
    .option("-o, --format <format>", "output format: table, json, yaml", "table")
    .option("--json", "output in JSON format (alias for --format json)")
    .option("-q, --quiet", "minimal output (IDs only)")
    .option("--no-headers", "omit table headers")
    .option("--no-color", "disable colored output");
  addDaemonHostOption(program);

  registerCommands(program);

  // Stop root parsing at the command so `plugin update --version` belongs to update.
  // Keep global options available after a command, as they were before positional parsing.
  program.enablePositionalOptions();
  for (const command of program.commands) {
    for (const option of program.options) {
      if (option.long === "--version") continue;
      if (!command.options.some((local) => local.long === option.long)) command.addOption(option);
      if (option.long === "--home" || option.long === "--host") continue;
      command.on(`option:${option.name()}`, () => {
        const key = option.attributeName();
        program.setOptionValueWithSource(key, command.opts()[key], "cli");
      });
    }
    if (command.name() !== "plugin")
      command.version(VERSION, "-v, --version", "output the version number");
  }

  const enforceSelectorDuplicates = (command: Command) => {
    for (const option of command.options) {
      if (option.long !== "--home" && option.long !== "--host") continue;
      option.argParser((value: string, previous: string | undefined) => {
        if (previous !== undefined && previous !== value)
          throw {
            code: "TARGET_AMBIGUOUS",
            message: `Conflicting duplicate ${option.long} selectors.`,
          };
        return value;
      });
    }
    command.commands.forEach(enforceSelectorDuplicates);
  };
  enforceSelectorDuplicates(program);
  return program;
}
