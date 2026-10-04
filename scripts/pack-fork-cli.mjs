// Packs the CLI as one self-contained npm package, `@mduan/paseo-cli`, for the
// personal fork. The fork's workspace packages (`@getpaseo/server`, `client`,
// ...) are not published, so they ride inside the tarball as
// `bundleDependencies`. Third-party dependencies stay normal dependencies so npm
// installs platform-correct native binaries (node-pty, sherpa-onnx-node,
// esbuild) on the target host.
//
// Two npm behaviors shape this script:
// - `npm pack` inside the workspace omits bundled workspace packages (they are
//   symlinks hoisted to the repo root), so it packs a staged directory instead.
// - npm never installs the dependencies of a bundled package, so the bundled
//   packages' third-party dependencies are hoisted into the CLI manifest. When two
//   packages need incompatible ranges, the copy npm nested in the workspace is
//   bundled under the package that needs it.
//
// Usage: node scripts/pack-fork-cli.mjs [--skip-build] [--skip-web-ui] [--publish]
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { isMainModule } from "./is-main-module.mjs";

export const FORK_CLI_PACKAGE = "@mduan/paseo-cli";
const WORKSPACE_CLI_PACKAGE = "@getpaseo/cli";
const FORK_VERSION_PATTERN = /^\d+\.\d+\.\d+-fork\.\d+$/;
const USAGE = "Usage: node scripts/pack-fork-cli.mjs [--skip-build] [--skip-web-ui] [--publish]\n";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outDir = path.join(rootDir, "dist", "fork-cli");
const stageDir = path.join(outDir, "stage");
const tarballDir = path.join(outDir, "workspace-tarballs");

function parseArgs(argv) {
  const args = { skipBuild: false, skipWebUi: false, publish: false };
  for (const arg of argv) {
    if (arg === "--skip-build") args.skipBuild = true;
    else if (arg === "--skip-web-ui") args.skipWebUi = true;
    else if (arg === "--publish") args.publish = true;
    else {
      process.stderr.write(USAGE);
      process.exit(arg === "--help" || arg === "-h" ? 0 : 1);
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args, options = {}) {
  process.stdout.write(`$ ${command} ${args.join(" ")}\n`);
  execFileSync(command, args, { cwd: rootDir, stdio: "inherit", ...options });
}

function loadWorkspacePackages() {
  const rootPackage = readJson(path.join(rootDir, "package.json"));
  const byName = new Map();
  for (const workspacePath of rootPackage.workspaces) {
    const dir = path.join(rootDir, workspacePath);
    const pkg = readJson(path.join(dir, "package.json"));
    byName.set(pkg.name, { dir, pkg });
  }
  return { rootVersion: rootPackage.version, byName };
}

// Workspace packages the CLI needs at runtime, following `dependencies` only.
export function collectBundledWorkspacePackages({ rootName, byName }) {
  const bundled = new Set();
  const queue = [rootName];
  while (queue.length > 0) {
    const name = queue.shift();
    for (const dependency of Object.keys(byName.get(name).pkg.dependencies ?? {})) {
      if (byName.has(dependency) && !bundled.has(dependency)) {
        bundled.add(dependency);
        queue.push(dependency);
      }
    }
  }
  return [...bundled].sort();
}

function narrowestRange(ranges) {
  return ranges.find((candidate) => ranges.every((range) => semver.subset(candidate, range)));
}

// Merges the third-party `dependencies` of the CLI and the bundled packages into
// one hoisted set. `installedVersion(name)` returns the version npm hoisted to the
// workspace root; it breaks ties when ranges are incompatible. Returns the hoisted
// ranges and, per package, the dependencies the hoisted range does not satisfy.
export function hoistThirdPartyDependencies({ manifests, isWorkspacePackage, installedVersion }) {
  const rangesByDependency = new Map();
  for (const [owner, manifest] of manifests) {
    for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
      if (isWorkspacePackage(dependency)) continue;
      if (!rangesByDependency.has(dependency)) rangesByDependency.set(dependency, []);
      rangesByDependency.get(dependency).push({ owner, range });
    }
  }

  const hoisted = {};
  const nested = [];
  for (const [dependency, entries] of [...rangesByDependency].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const ranges = [...new Set(entries.map((entry) => entry.range))];
    let range = narrowestRange(ranges);
    if (!range) {
      const rootVersion = installedVersion(dependency);
      range = narrowestRange(
        ranges.filter((candidate) => semver.satisfies(rootVersion, candidate)),
      );
      if (!range) {
        throw new Error(`No range for ${dependency} matches the root install ${rootVersion}.`);
      }
    }
    hoisted[dependency] = range;
    for (const entry of entries) {
      if (entry.range !== range && !semver.subset(range, entry.range)) {
        nested.push({ owner: entry.owner, dependency, range: entry.range });
      }
    }
  }
  return { hoisted, nested };
}

// npm treats every dependency of a bundled package as part of the bundle: it
// skips fetching them yet still runs their install scripts. A bundled package
// therefore keeps only the dependencies that really are in the tarball; the
// hoisted ones resolve from the CLI's node_modules.
export function buildBundledManifest({ manifest, isWorkspacePackage, nestedDependencies }) {
  const {
    dependencies = {},
    peerDependencies: _peerDependencies,
    peerDependenciesMeta: _peerDependenciesMeta,
    optionalDependencies: _optionalDependencies,
    ...rest
  } = manifest;
  return {
    ...rest,
    dependencies: Object.fromEntries(
      Object.entries(dependencies).filter(
        ([name]) => isWorkspacePackage(name) || nestedDependencies.includes(name),
      ),
    ),
  };
}

// The staged package.json: published under the fork name, bundling the
// workspace packages, with no lifecycle scripts or dev-only fields.
export function buildForkCliManifest({ cliManifest, bundledPackages, hoisted, version }) {
  const dependencies = { ...hoisted };
  for (const name of bundledPackages) {
    dependencies[name] = version;
  }
  const { scripts: _scripts, devDependencies: _devDependencies, ...rest } = cliManifest;
  return {
    ...rest,
    name: FORK_CLI_PACKAGE,
    version,
    description: `${cliManifest.description} (mduan fork)`,
    dependencies: Object.fromEntries(
      Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
    ),
    bundleDependencies: bundledPackages,
  };
}

function packWorkspace(name) {
  const output = execFileSync(
    "npm",
    [
      "pack",
      `--workspace=${name}`,
      "--ignore-scripts",
      "--json",
      `--pack-destination=${tarballDir}`,
    ],
    { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const [result] = JSON.parse(output);
  return path.join(tarballDir, result.filename);
}

function extractTarball({ tarball, destination }) {
  mkdirSync(destination, { recursive: true });
  execFileSync("tar", ["xzf", tarball, "-C", destination, "--strip-components=1"]);
}

// Copies the copy npm nested under a workspace package (because its range
// conflicts with the root install) into the bundle. A nested copy with its own
// dependencies would need those bundled too, so it is rejected. Its peer
// dependencies must resolve to hoisted packages.
function bundleNestedDependency({ byName, hoisted, owner, dependency, range }) {
  const source = path.join(byName.get(owner).dir, "node_modules", dependency);
  if (!existsSync(source)) {
    throw new Error(`${owner} needs ${dependency}@${range}, but the workspace has no nested copy.`);
  }
  const pkg = readJson(path.join(source, "package.json"));
  if (!semver.satisfies(pkg.version, range)) {
    throw new Error(
      `${owner} needs ${dependency}@${range}, but the nested copy is ${pkg.version}.`,
    );
  }
  if (Object.keys(pkg.dependencies ?? {}).length > 0) {
    throw new Error(
      `${owner} needs ${dependency}@${range}, which has its own dependencies and cannot be bundled.`,
    );
  }
  const unresolvedPeers = Object.keys(pkg.peerDependencies ?? {}).filter((peer) => !hoisted[peer]);
  if (unresolvedPeers.length > 0) {
    throw new Error(`${dependency} has peers that are not hoisted: ${unresolvedPeers.join(", ")}.`);
  }
  const destination = path.join(stageDir, "node_modules", owner, "node_modules", dependency);
  cpSync(source, destination, { recursive: true, dereference: true });
  writeJson(
    path.join(destination, "package.json"),
    buildBundledManifest({
      manifest: pkg,
      isWorkspacePackage: () => false,
      nestedDependencies: [],
    }),
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { rootVersion, byName } = loadWorkspacePackages();
  if (!FORK_VERSION_PATTERN.test(rootVersion)) {
    throw new Error(`Root version ${rootVersion} is not a fork version like 0.11.0-fork.1.`);
  }

  if (!args.skipBuild) {
    run("npm", ["run", "build:server:clean"]);
    if (!args.skipWebUi) {
      run("npm", ["run", "build:daemon-web-ui"]);
    }
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(tarballDir, { recursive: true });

  const bundledPackages = collectBundledWorkspacePackages({
    rootName: WORKSPACE_CLI_PACKAGE,
    byName,
  });
  extractTarball({ tarball: packWorkspace(WORKSPACE_CLI_PACKAGE), destination: stageDir });
  for (const name of bundledPackages) {
    extractTarball({
      tarball: packWorkspace(name),
      destination: path.join(stageDir, "node_modules", name),
    });
  }

  const manifestPath = path.join(stageDir, "package.json");
  const cliManifest = readJson(manifestPath);
  const { hoisted, nested } = hoistThirdPartyDependencies({
    manifests: [
      [WORKSPACE_CLI_PACKAGE, cliManifest],
      ...bundledPackages.map((name) => [name, byName.get(name).pkg]),
    ],
    isWorkspacePackage: (name) => byName.has(name),
    installedVersion: (name) =>
      readJson(path.join(rootDir, "node_modules", name, "package.json")).version,
  });
  for (const entry of nested) {
    bundleNestedDependency({ byName, hoisted, ...entry });
  }
  for (const name of bundledPackages) {
    const bundledManifestPath = path.join(stageDir, "node_modules", name, "package.json");
    writeJson(
      bundledManifestPath,
      buildBundledManifest({
        manifest: readJson(bundledManifestPath),
        isWorkspacePackage: (dependency) => byName.has(dependency),
        nestedDependencies: nested
          .filter((entry) => entry.owner === name)
          .map((entry) => entry.dependency),
      }),
    );
  }
  writeJson(
    manifestPath,
    buildForkCliManifest({ cliManifest, bundledPackages, hoisted, version: rootVersion }),
  );

  const packOutput = execFileSync("npm", ["pack", "--json", `--pack-destination=${outDir}`], {
    cwd: stageDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [packResult] = JSON.parse(packOutput);
  const tarball = path.join(outDir, packResult.filename);
  const expectedPaths = [
    ...bundledPackages.map((name) => `node_modules/${name}/`),
    ...nested.map(({ owner, dependency }) => `node_modules/${owner}/node_modules/${dependency}/`),
  ];
  const missing = expectedPaths.filter(
    (prefix) => !packResult.files.some((file) => file.path.startsWith(prefix)),
  );
  if (missing.length > 0) {
    throw new Error(`Tarball is missing bundled paths: ${missing.join(", ")}`);
  }

  // Fork versions are semver prereleases, which npm only publishes with an
  // explicit tag. `latest` is what the daemon self-update and Host settings install.
  const publishArgs = ["publish", tarball, "--access", "public", "--tag", "latest"];
  process.stdout.write(
    `\nPacked ${FORK_CLI_PACKAGE}@${rootVersion} (${packResult.entryCount} files)\n${tarball}\n`,
  );
  if (args.publish) {
    run("npm", publishArgs);
    return;
  }
  process.stdout.write(`\nPublish with:\n  npm ${publishArgs.join(" ")}\n`);
}

if (isMainModule(import.meta.url)) {
  main();
}
