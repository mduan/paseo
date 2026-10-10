---
name: release-fork
description: Release Paseo fork daemon changes when needed, build the Apple Silicon Mac DMG, and report its folder path. Use for "release fork" or "/release-fork".
---

# Release fork

Read **Fork CLI release** in `docs/release.md` and the fork scripts in `package.json`. Use this `mduan/paseo` checkout. Publish only `@mduan/paseo-cli`, without Git pushes or GitHub releases.

A workflow request authorizes conditional publication, merging the release into local `main`, and the local build. Skill edits and release previews authorize preparation only.

Log builds in task-specific temporary files. Wait for successful exits. Always build the DMG, even with skipped publication or an unresolved baseline.

## Decide whether publication is needed

1. Check the remote, branch, working tree, and root version. Obey repository rules for branches, unrelated changes, and uncommitted release inputs.
2. Query npm:

   ```bash
   npm view @mduan/paseo-cli version gitHead dist-tags --json --prefer-online --fetch-retries=0 --fetch-timeout=15000
   ```

   Record `latest`. Query its exact-version metadata. Check known pending uploads before allocating a version. Registry metadata proves publication, not local versions or upload acknowledgements.

3. Verify npm `gitHead` belongs to this fork and matches its version. If absent, corroborate a version commit/tag through release records or the published tarball. If unresolved, ask for the baseline and defer publication.
4. Read `git diff <published-sha> HEAD -- <inputs>`. Derive inputs from `scripts/pack-fork-cli.mjs`, CLI workspace dependencies, and the daemon web UI build. Count runtime source/assets, dependencies, patches, and build/packaging changes, including the bundled web UI. Exclude tests, docs, version-only edits, and desktop-only changes.
5. Report the published version, baseline, changes, and publication decision. If behind or diverged from a newer published build, resolve the intended source before replacing `latest`.

## Publish changed daemon inputs

If relevant inputs match the published build, skip publication.

1. Choose an unused `X.Y.Z-fork.N` newer than local and published versions. On a clean tree, use `npm run version:fork` to synchronize and commit. If npm is ahead, use `npm pkg set version=<version>`, `npm run version:sync-internal`, and `npm run release:prepare`. Commit after verification. Avoid `npm version`, which requires an F-Droid changelog entry.
2. After committing the version bump, merge the release branch into local `main`. If already on `main`, verify it contains the version commit. Use the merged `main` checkout for the remaining release steps, including packing, npm publication, and the Mac build.
3. Run `npm run release:fork:cli` without skip flags or `--publish` to rebuild the server, declarations, and web UI. Retain the tarball path.
4. Review changes and related callers. Run `npm run format`, `npm run lint`, and `npm run typecheck` under repository rebuild guidance. Run focused tests as needed, never the full suite. Commit remaining release changes.
5. Publish the verified tarball once:

   ```bash
   npm publish dist/fork-cli/mduan-paseo-cli-<version>.tgz --access public --tag latest
   ```

   Prereleases require explicit `latest`. Avoid workspace publication and `npm run release:fork`, which bypass these checks.

6. Verify the exact version and `latest` with fresh queries. Match remote `dist.shasum` to the tarball's SHA-1. For accepted uploads still in processing, poll every 30 seconds for up to 10 minutes during the Mac build. After timeouts or ambiguous results, inspect exact-version metadata before retrying. If unresolved, report pending and preserve the version, tarball, and logs. Do not allocate another version or republish blindly.

## Build and report the Mac app

1. If publication was skipped or deferred, merge the release branch into local `main` first. Run `npm run build:fork` from the `main` checkout. It disables desktop publication and uses ad hoc signing without notarization.
2. Verify a nonempty `packages/desktop/release/Paseo-<version>-arm64.dmg` for the workspace version. Leave it unopened and unmounted. Installation and main-daemon restart (port 6767) require separate permission.
3. Report publication status (skipped, verified, pending, or failed), version/release commit, signing limitation, and unfinished-step logs. In the final response, output the absolute path to the DMG folder: `<checkout>/packages/desktop/release/`.
