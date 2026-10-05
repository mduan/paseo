// Bumps the fork version (0.11.0-fork.1 -> 0.11.0-fork.2) across the workspace
// and commits it. It skips the npm `version` lifecycle that upstream releases
// use, because its F-Droid step needs a CHANGELOG.md entry that fork versions
// do not have.
//
// Usage: node scripts/bump-fork-version.mjs [--print]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./is-main-module.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootPackagePath = path.join(rootDir, "package.json");

export function nextForkVersion(version) {
  const match = /^(\d+\.\d+\.\d+)-fork\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Root version ${version} is not a fork version like 0.11.0-fork.1.`);
  }
  return `${match[1]}-fork.${Number(match[2]) + 1}`;
}

function run(command, args) {
  process.stdout.write(`$ ${command} ${args.join(" ")}\n`);
  execFileSync(command, args, { cwd: rootDir, stdio: "inherit" });
}

function main() {
  const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
  const version = nextForkVersion(rootPackage.version);
  if (process.argv.includes("--print")) {
    process.stdout.write(`${version}\n`);
    return;
  }
  if (execFileSync("git", ["status", "--porcelain"], { cwd: rootDir, encoding: "utf8" }).trim()) {
    throw new Error("Working tree is not clean. Commit or set aside changes before bumping.");
  }

  process.stdout.write(`Bumping ${rootPackage.version} -> ${version}\n`);
  writeFileSync(rootPackagePath, `${JSON.stringify({ ...rootPackage, version }, null, 2)}\n`);
  run("npm", ["run", "version:sync-internal"]);
  run("npm", ["run", "release:prepare"]);
  run("git", ["add", "-A"]);
  run("git", ["commit", "-m", `chore: version ${version}`]);
}

if (isMainModule(import.meta.url)) {
  main();
}
