// Builds the fork's unsigned Apple Silicon DMG. It follows `npm run build:desktop` (root and
// desktop `build` scripts); mirror any step added there. `build:server:clean` already rebuilds
// the shared packages that `build:app-deps:clean` would, so they build once.
//
// `release:fork:cli` runs the same `build:server:clean`. When it ran on the current clean
// commit, it leaves a one-shot stamp and this build reuses that output.
//
// Usage: node scripts/build-fork-mac.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./is-main-module.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stampPath = path.join(rootDir, "dist", "fork-server-build.json");

function run(command, args, options = {}) {
  process.stdout.write(`$ ${command} ${args.join(" ")}\n`);
  execFileSync(command, args, { cwd: rootDir, stdio: "inherit", ...options });
}

function git(args) {
  return execFileSync("git", args, { cwd: rootDir, encoding: "utf8" }).trim();
}

/** The HEAD commit when the working tree, including untracked files, matches it. */
function cleanHead() {
  return git(["status", "--porcelain"]) ? undefined : git(["rev-parse", "HEAD"]);
}

function readStamp() {
  try {
    return JSON.parse(readFileSync(stampPath, "utf8"));
  } catch {
    return undefined;
  }
}

export function canReuseServerBuild({ head, stamp }) {
  return Boolean(head) && stamp?.head === head;
}

/** Runs `build:server:clean` and stamps its output when the tree stayed on one clean commit. */
export function buildServerClean() {
  rmSync(stampPath, { force: true });
  const head = cleanHead();
  run("npm", ["run", "build:server:clean"]);
  if (head && cleanHead() === head) {
    mkdirSync(path.dirname(stampPath), { recursive: true });
    writeFileSync(stampPath, `${JSON.stringify({ head })}\n`);
  }
}

function main() {
  const stamp = readStamp();
  rmSync(stampPath, { force: true });
  if (canReuseServerBuild({ head: cleanHead(), stamp })) {
    process.stdout.write(`Reusing the server build from ${stamp.head}\n`);
  } else {
    run("npm", ["run", "build:server:clean"]);
  }
  run("npm", ["run", "build", "--workspace=@getpaseo/expo-two-way-audio"]);
  run("npx", ["expo", "export", "--platform", "web"], {
    cwd: path.join(rootDir, "packages", "app"),
    env: { ...process.env, PASEO_WEB_PLATFORM: "electron" },
  });
  run("npm", ["run", "build:main", "--workspace=@getpaseo/desktop"]);
  run(
    "npx",
    [
      "electron-builder",
      "--config",
      "electron-builder.yml",
      "--publish",
      "never",
      "--mac",
      "dmg",
      "--arm64",
      "-c.mac.notarize=false",
      "-c.mac.identity=-",
      "-c.mac.hardenedRuntime=false",
    ],
    {
      cwd: path.join(rootDir, "packages", "desktop"),
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
    },
  );
}

if (isMainModule(import.meta.url)) {
  main();
}
