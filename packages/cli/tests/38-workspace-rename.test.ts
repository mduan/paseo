#!/usr/bin/env npx tsx

import assert from "node:assert";
import { basename } from "node:path";
import { createE2ETestContext } from "./helpers/test-daemon.ts";

console.log("=== Workspace Rename Command ===\n");

const ctx = await createE2ETestContext({ timeout: 30000 });

try {
  const created = await ctx.paseo([
    "workspace",
    "create",
    "--isolation",
    "local",
    "--path",
    ctx.workDir,
    "--title",
    "Original title",
    "--json",
  ]);
  assert.strictEqual(created.exitCode, 0, created.stderr);
  const workspaceId = JSON.parse(created.stdout).workspaceId as string;

  const issueUrl = "https://linear.app/acme/issue/ENG-123";
  const linked = await ctx.paseo([
    "workspace",
    "update",
    workspaceId,
    "--add-linear-issue",
    issueUrl,
    "--add-linear-issue",
    `${issueUrl}/a-title?query#fragment`,
    "--json",
  ]);
  assert.strictEqual(linked.exitCode, 0, linked.stderr);
  assert.deepStrictEqual(JSON.parse(linked.stdout), {
    workspaceId,
    linearIssues: [{ identifier: "ENG-123", url: issueUrl }],
  });
  for (const id of ["missing-workspace", ""]) {
    const invalid = await ctx.paseo([
      "workspace",
      "update",
      id,
      "--add-linear-issue",
      issueUrl,
      "--json",
    ]);
    assert.notStrictEqual(invalid.exitCode, 0);
  }
  const invalidUrl = await ctx.paseo([
    "workspace",
    "update",
    workspaceId,
    "--add-linear-issue",
    "https://linear.app/acme/issue/ENG-999",
    "--add-linear-issue",
    "ENG-1",
    "--json",
  ]);
  assert.notStrictEqual(invalidUrl.exitCode, 0);
  const unchanged = await ctx.paseo([
    "workspace",
    "update",
    workspaceId,
    "--add-linear-issue",
    issueUrl,
    "--json",
  ]);
  assert.deepStrictEqual(JSON.parse(unchanged.stdout), JSON.parse(linked.stdout));
  const unlinked = await ctx.paseo([
    "workspace",
    "update",
    workspaceId,
    "--remove-linear-issue",
    `${issueUrl}/old-title#comment`,
    "--json",
  ]);
  assert.strictEqual(unlinked.exitCode, 0, unlinked.stderr);
  assert.deepStrictEqual(JSON.parse(unlinked.stdout), { workspaceId, linearIssues: [] });

  const renamed = await ctx.paseo(["workspace", "rename", workspaceId, "Auth rework", "--json"]);
  assert.strictEqual(renamed.exitCode, 0, renamed.stderr);
  assert.deepStrictEqual(JSON.parse(renamed.stdout), {
    workspaceId,
    title: "Auth rework",
  });

  const renamedList = await ctx.paseo(["workspace", "ls", "--json"]);
  assert.strictEqual(renamedList.exitCode, 0, renamedList.stderr);
  assert.strictEqual(
    JSON.parse(renamedList.stdout).find(
      (workspace: { workspaceId: string }) => workspace.workspaceId === workspaceId,
    )?.name,
    "Auth rework",
  );

  const reset = await ctx.paseo(["workspace", "rename", workspaceId, "--reset", "--json"]);
  assert.strictEqual(reset.exitCode, 0, reset.stderr);
  assert.deepStrictEqual(JSON.parse(reset.stdout), { workspaceId, title: null });

  const resetList = await ctx.paseo(["workspace", "ls", "--json"]);
  assert.strictEqual(resetList.exitCode, 0, resetList.stderr);
  assert.strictEqual(
    JSON.parse(resetList.stdout).find(
      (workspace: { workspaceId: string }) => workspace.workspaceId === workspaceId,
    )?.name,
    basename(ctx.workDir),
  );
} finally {
  await ctx.stop();
}

console.log("=== Workspace Rename Command Tests Passed ===");
