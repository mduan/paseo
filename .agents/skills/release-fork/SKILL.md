---
name: release-fork
description: Publish changed Paseo fork daemon builds to npm, then build the Apple Silicon Mac app and open its DMG in Finder. Use for "release fork", "/release-fork", or requests to publish daemon changes only when needed and build the Mac app.
---

# Release fork

Publish `@mduan/paseo-cli` only when daemon inputs have changed since the last published fork build. Then build the Mac app and open and reveal its DMG in Finder, including when publication is skipped.

Read the **Fork CLI release** section of `docs/release.md` and the fork scripts in `package.json`. This workflow uses the current checkout of `mduan/paseo`; it does not push Git refs or publish upstream packages or GitHub releases.

A request to carry out this workflow authorizes the conditional npm publication and local build. A request to create or edit this skill, or preview a release, authorizes preparation only.

## Decide whether publication is needed

1. Check the Git remote, branch, working tree, and root version. Preserve unrelated changes. The build must use the intended source; resolve uncommitted release inputs before publication. Follow the repository's branch rules before changing versions.
2. Query the actual fork package, rather than `@mduan/paseo` or the upstream workspace names:

   ```bash
   npm view @mduan/paseo-cli version gitHead dist-tags --json --prefer-online --fetch-retries=0 --fetch-timeout=15000
   ```

   Record the `latest` version and query that exact version's metadata. A local package version or successful upload from a previous chat does not establish what npm serves. Check any known pending version before allocating another version.

3. Resolve the published version to its source commit. Prefer its npm `gitHead`, after checking that the commit belongs to this fork and has the matching version. A staged tarball may lack `gitHead`; in that case, locate the matching version commit or tag and corroborate it with release records or the published tarball. If the source remains uncertain, report the missing baseline and ask for it; the local Mac build can still proceed.
4. Compare the published source with the intended checkout using `git diff <published-sha> HEAD -- <inputs>`. Read changed files, rather than treating any commit or version difference as a daemon change. Determine inputs from `scripts/pack-fork-cli.mjs`, the CLI's transitive workspace dependencies, and the daemon web UI build. Include runtime source and assets, dependency changes, patches, and build/packaging scripts that affect the published daemon. Ignore tests, documentation, and version-only manifest or lockfile edits. Desktop-only changes do not require npm publication; changes to the bundled daemon web UI do.
5. State the published version, source baseline, relevant changes, and whether publication is needed. If the checkout is behind or diverges from a newer published build, resolve the intended release source before replacing `latest`.

## Publish changed daemon inputs

Skip this section when the relevant inputs match the published build.

1. Choose an unused `X.Y.Z-fork.N` version newer than the published and local versions. Check exact-version metadata before using it. If the next local fork number is available and newer than npm, use `npm run version:fork`; it synchronizes workspaces and the lockfile and commits the bump, and requires a clean tree. If npm is ahead of the local number, set the chosen version with `npm pkg set version=<version>`, then run `npm run version:sync-internal` and `npm run release:prepare`, and commit only the release changes after verification. Avoid `npm version`, whose upstream lifecycle requires an F-Droid changelog entry.
2. Pack without publishing so verification precedes the upload:

   ```bash
   npm run release:fork:cli
   ```

   Capture long build output in a task-specific temporary log and wait for the process to finish successfully. Use the tarball path printed by the script. Keep the server build and web UI export enabled so the tarball contains current outputs.

3. Run `npm run format`, `npm run lint`, and `npm run typecheck`. The pack step rebuilds workspace declarations; follow the repository's rebuild guidance if declarations are stale. Run focused tests for changed release or daemon behavior as needed, never the full suite. Review the resulting diff and related callers, and commit any remaining release changes before publishing.
4. Publish the verified tarball once:

   ```bash
   npm publish dist/fork-cli/mduan-paseo-cli-<version>.tgz --access public --tag latest
   ```

   `latest` must be explicit because fork versions are prereleases. Use the staged fork tarball, not workspace publication commands. Avoid the combined `npm run release:fork`, which bumps and publishes without the conditional comparison or verification gate.

5. Verify both the exact version and the `latest` dist-tag with fresh npm queries. Compare the remote `dist.shasum` with the tarball's SHA-1. npm may accept an upload while it is still processing; an upload acknowledgement alone is not completion. Poll at intervals of about 30 seconds for up to 10 minutes, continuing the Mac build while waiting. After a timeout or ambiguous upload result, inspect exact-version metadata before any retry. If publication remains pending, report it as pending and preserve the version, tarball, and logs for follow-up; do not bump again or republish blindly.

## Build and open the Mac app

1. Run the existing Apple Silicon fork build and wait for its successful exit:

   ```bash
   npm run build:fork
   ```

   Capture output in a task-specific temporary log. This script uses ad hoc signing, skips notarization, and disables desktop publication. Report the signing limitation with the result.

2. Read the current workspace version and confirm that the build produced a nonempty `packages/desktop/release/Paseo-<version>-arm64.dmg`. Open that exact artifact and reveal it in Finder:

   ```bash
   open "packages/desktop/release/Paseo-<version>-arm64.dmg"
   open -R "packages/desktop/release/Paseo-<version>-arm64.dmg"
   ```

   Check `hdiutil info` to confirm the DMG mounted. Opening the installer does not authorize installing the app or restarting the main daemon on port 6767.

3. Report whether daemon publication was skipped, verified, pending, or failed; the version and release commit when applicable; and the DMG path and whether it opened. Preserve build logs for any failed or unfinished step.
