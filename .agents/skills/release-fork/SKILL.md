---
name: release-fork
description: Publish Paseo fork daemon changes only when needed, then build the Apple Silicon Mac app and open its DMG in Finder. Use for "release fork", "/release-fork", or requests for this workflow.
---

# Release fork

Read **Fork CLI release** in `docs/release.md` and the fork scripts in `package.json`. Use the current `mduan/paseo` checkout. Publish only `@mduan/paseo-cli`; do not push Git refs or publish GitHub releases.

A workflow request authorizes conditional publication and the local build. Skill edits and release previews authorize preparation only.

Capture builds in task-specific temporary logs and wait for successful exits. Always build and open the Mac DMG, even when publication is skipped or its baseline is unresolved.

## Decide whether publication is needed

1. Check the remote, branch, working tree, and root version. Follow repository branch rules; preserve unrelated changes and resolve uncommitted release inputs before publishing.
2. Query npm:

   ```bash
   npm view @mduan/paseo-cli version gitHead dist-tags --json --prefer-online --fetch-retries=0 --fetch-timeout=15000
   ```

   Record `latest`, query its exact-version metadata, and check known pending uploads before allocating a version. Local versions and upload acknowledgements are not publication evidence.

3. Resolve the published source: verify npm `gitHead` belongs to this fork and matches the version. Staged tarballs may lack it; corroborate a matching version commit/tag with release records or the published tarball. If uncertain, ask for the baseline and defer publication.
4. Read `git diff <published-sha> HEAD -- <inputs>`. Derive inputs from `scripts/pack-fork-cli.mjs`, CLI workspace dependencies, and the daemon web UI build. Count runtime source/assets, dependencies, patches, and build/packaging changes. Ignore tests, docs, version-only edits, and desktop-only changes; bundled daemon web UI changes count.
5. Report the published version, baseline, relevant changes, and publication decision. If the checkout is behind or diverges from a newer published build, resolve the intended source before replacing `latest`.

## Publish changed daemon inputs

Skip this section when the relevant inputs match the published build.

1. Check exact-version metadata and choose an unused `X.Y.Z-fork.N` newer than local and published versions. On a clean tree, `npm run version:fork` synchronizes and commits the next local version. If npm is ahead, use `npm pkg set version=<version>`, `npm run version:sync-internal`, and `npm run release:prepare`; commit release changes after verification. Avoid `npm version`: its upstream lifecycle requires an F-Droid changelog entry.
2. Run `npm run release:fork:cli` without skip flags or `--publish`; retain its printed tarball path. This rebuilds the server, declarations, and web UI before packing.
3. Run `npm run format`, `npm run lint`, and `npm run typecheck`; follow repository rebuild guidance for stale declarations. Run focused tests as needed, never the full suite. Review changes and related callers, then commit remaining release changes.
4. Publish the verified tarball once:

   ```bash
   npm publish dist/fork-cli/mduan-paseo-cli-<version>.tgz --access public --tag latest
   ```

   Fork prereleases require explicit `latest`. Avoid workspace publication and the combined `npm run release:fork`, which bypasses these checks.

5. Verify the exact version and `latest` with fresh queries; match remote `dist.shasum` to the tarball's SHA-1. npm may still be processing an accepted upload. Poll about every 30 seconds for up to 10 minutes while building the Mac app. After a timeout or ambiguous result, inspect exact-version metadata before retrying. Report unresolved publication as pending; preserve its version, tarball, and logs instead of bumping or republishing blindly.

## Build and open the Mac app

1. Run `npm run build:fork`. It disables desktop publication and uses ad hoc signing without notarization; report this limitation.
2. Read the workspace version and confirm a nonempty `packages/desktop/release/Paseo-<version>-arm64.dmg`, then open and reveal it:

   ```bash
   open "packages/desktop/release/Paseo-<version>-arm64.dmg"
   open -R "packages/desktop/release/Paseo-<version>-arm64.dmg"
   ```

   Confirm mounting with `hdiutil info`. Installation and restarting the main daemon on port 6767 require separate permission.

3. Report publication status (skipped, verified, pending, or failed), version/release commit, DMG path/open status, and logs for unfinished steps.
