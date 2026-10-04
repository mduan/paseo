import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBundledManifest,
  buildForkCliManifest,
  collectBundledWorkspacePackages,
  hoistThirdPartyDependencies,
} from "./pack-fork-cli.mjs";

function workspace(packages) {
  return new Map(Object.entries(packages).map(([name, pkg]) => [name, { dir: name, pkg }]));
}

test("collects the workspace packages the CLI depends on transitively", () => {
  const byName = workspace({
    "@getpaseo/cli": { dependencies: { "@getpaseo/server": "1.0.0", chalk: "^5.0.0" } },
    "@getpaseo/server": { dependencies: { "@getpaseo/relay": "1.0.0", express: "^4.0.0" } },
    "@getpaseo/relay": { dependencies: {} },
    "@getpaseo/app": { dependencies: {} },
  });

  assert.deepEqual(collectBundledWorkspacePackages({ rootName: "@getpaseo/cli", byName }), [
    "@getpaseo/relay",
    "@getpaseo/server",
  ]);
});

test("hoists the narrowest compatible range", () => {
  const { hoisted, nested } = hoistThirdPartyDependencies({
    manifests: [
      ["@getpaseo/cli", { dependencies: { yaml: "^2.8.4", "@getpaseo/server": "1.0.0" } }],
      ["@getpaseo/server", { dependencies: { yaml: "2.9.1", express: "^4.18.2" } }],
    ],
    isWorkspacePackage: (name) => name.startsWith("@getpaseo/"),
    installedVersion: () => {
      throw new Error("not needed for compatible ranges");
    },
  });

  assert.deepEqual(hoisted, { express: "^4.18.2", yaml: "2.9.1" });
  assert.deepEqual(nested, []);
});

test("hoists the range the root install satisfies and nests the conflicting one", () => {
  const { hoisted, nested } = hoistThirdPartyDependencies({
    manifests: [
      ["@getpaseo/server", { dependencies: { "@agentclientprotocol/sdk": "^0.17.1" } }],
      ["@getpaseo/plugin", { dependencies: { "@agentclientprotocol/sdk": "^1.4.0" } }],
    ],
    isWorkspacePackage: () => false,
    installedVersion: () => "0.17.1",
  });

  assert.deepEqual(hoisted, { "@agentclientprotocol/sdk": "^0.17.1" });
  assert.deepEqual(nested, [
    { owner: "@getpaseo/plugin", dependency: "@agentclientprotocol/sdk", range: "^1.4.0" },
  ]);
});

test("bundled manifests keep only dependencies that ship in the tarball", () => {
  const manifest = buildBundledManifest({
    manifest: {
      name: "@getpaseo/plugin",
      dependencies: {
        "@getpaseo/client": "1.0.0",
        "@agentclientprotocol/sdk": "^1.4.0",
        express: "^4.0.0",
      },
      peerDependencies: { react: "~19.1.0" },
      peerDependenciesMeta: { react: { optional: true } },
    },
    isWorkspacePackage: (name) => name.startsWith("@getpaseo/"),
    nestedDependencies: ["@agentclientprotocol/sdk"],
  });

  assert.deepEqual(manifest, {
    name: "@getpaseo/plugin",
    dependencies: { "@getpaseo/client": "1.0.0", "@agentclientprotocol/sdk": "^1.4.0" },
  });
});

test("the fork manifest renames the CLI and bundles the workspace packages", () => {
  const manifest = buildForkCliManifest({
    cliManifest: {
      name: "@getpaseo/cli",
      version: "0.11.0-fork.1",
      description: "Paseo CLI",
      bin: { paseo: "bin/paseo" },
      scripts: { prepack: "npm run build" },
      dependencies: { "@getpaseo/server": "0.11.0-fork.1", chalk: "^5.0.0" },
      devDependencies: { vitest: "^4.0.0" },
    },
    bundledPackages: ["@getpaseo/relay", "@getpaseo/server"],
    hoisted: { chalk: "^5.0.0", express: "^4.18.2" },
    version: "0.11.0-fork.2",
  });

  assert.deepEqual(manifest, {
    name: "@mduan/paseo-cli",
    version: "0.11.0-fork.2",
    description: "Paseo CLI (mduan fork)",
    bin: { paseo: "bin/paseo" },
    dependencies: {
      "@getpaseo/relay": "0.11.0-fork.2",
      "@getpaseo/server": "0.11.0-fork.2",
      chalk: "^5.0.0",
      express: "^4.18.2",
    },
    bundleDependencies: ["@getpaseo/relay", "@getpaseo/server"],
  });
});
