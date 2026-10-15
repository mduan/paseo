import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function createShallowGitClone(input: {
  sourcePath: string;
  clonePath: string;
  baseCommits: number;
}): void {
  const { sourcePath, clonePath, baseCommits } = input;
  const cwd = sourcePath;
  const root = execFileSync("git", ["rev-parse", "HEAD"], { cwd }).toString().trim();
  execFileSync("git", ["checkout", "-b", "feature"], { cwd });
  writeFileSync(join(cwd, "feature.txt"), "feature\n");
  execFileSync("git", ["add", "feature.txt"], { cwd });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "feature"], { cwd });
  let history = "";
  for (let index = 1; index <= baseCommits; index += 1) {
    history += `commit refs/heads/main\nmark :${index}\ncommitter Test <test@test.com> ${1700000000 + index} +0000\ndata 4\nbase\nfrom ${index === 1 ? root : `:${index - 1}`}\n\n`;
  }
  execFileSync("git", ["fast-import", "--quiet"], { cwd, input: history });
  execFileSync("git", [
    "clone",
    "--depth=1",
    "--no-single-branch",
    "-b",
    "feature",
    pathToFileURL(sourcePath).href,
    clonePath,
  ]);
  execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], {
    cwd: clonePath,
  });
}
