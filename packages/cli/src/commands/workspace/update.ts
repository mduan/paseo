/* oxlint-disable typescript/consistent-type-definitions -- Workspace instructions require type aliases. */
import type { Command } from "commander";
import type { LinearIssue } from "@getpaseo/protocol/messages";
import { updateLinearIssues } from "@getpaseo/protocol/linear-issues";
import { connectToDaemon } from "../../utils/client.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";
import type { CommandError, OutputSchema, SingleResult } from "../../output/index.js";

type WorkspaceUpdateResult = {
  workspaceId: string;
  linearIssues: LinearIssue[];
};

type WorkspaceUpdateOptions = {
  daemonTarget: DaemonTarget;
  addLinearIssue?: string[];
  removeLinearIssue?: string[];
};

const schema: OutputSchema<WorkspaceUpdateResult> = {
  idField: "workspaceId",
  columns: [
    { header: "WORKSPACE ID", field: "workspaceId", width: 24 },
    {
      header: "LINEAR ISSUES",
      field: (result) => result.linearIssues.map((issue) => issue.identifier).join(", "),
    },
  ],
};

export async function runUpdateCommand(
  workspaceId: string,
  options: WorkspaceUpdateOptions,
  _command: Command,
): Promise<SingleResult<WorkspaceUpdateResult>> {
  const add = options.addLinearIssue ?? [];
  const remove = options.removeLinearIssue ?? [];
  if (!workspaceId.trim() || (!add.length && !remove.length)) {
    throw {
      code: "INVALID_OPTIONS",
      message:
        "Pass a workspace ID and at least one --add-linear-issue or --remove-linear-issue URL.",
    } satisfies CommandError;
  }
  try {
    updateLinearIssues({ add, remove });
  } catch (error) {
    throw {
      code: "INVALID_OPTIONS",
      message: error instanceof Error ? error.message : String(error),
    } satisfies CommandError;
  }
  const client = await connectToDaemon({ target: options.daemonTarget });
  try {
    const data = await client.updateWorkspaceLinearIssues({ workspaceId, add, remove });
    return { type: "single", data, schema };
  } finally {
    await client.close().catch(() => undefined);
  }
}
