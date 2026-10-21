---
name: release-fork-android
description: Build and sign a Paseo Fork Android release APK, then return its local file link. Use for "release fork android", "/release-fork-android", or requests for a Paseo fork APK download.
---

# Release fork Android

Read [Android](../../../docs/android.md) for the fork variant, toolchain, and signing key. Use this `mduan/paseo` checkout. A build request includes signing the APK. Skill edits and previews authorize preparation only.

## Build

1. Check the remote, branch, working tree, root version, and source commit. Build the requested source; otherwise use the current checkout. Keep the existing fork version. This workflow does not publish npm packages or GitHub releases, push Git, or install the app.
2. Resolve Java and the Android SDK from `.tool-versions` and `.mise.toml`. Use the installed toolchain, supplying `JAVA_HOME` and `ANDROID_HOME` to Gradle. Check the signing files described in `docs/android.md`; if missing, ask for the existing key before distributing an APK. Replacing it breaks updates to existing fork installations.
3. Build workspace dependencies with `npm run build:app-deps` unless they were already built for this source. From `packages/app`, generate the fork project:

   ```bash
   CI=1 APP_VARIANT=fork npx --no-install expo prebuild --platform android --no-install
   ```

   Expo uses `CI=1` for noninteractive execution. Inspect an existing generated Android project before replacing it; preserve user edits and regenerate cleanly when changing variants.

4. From `packages/app/android`, build without installing:

   ```bash
   CI=1 APP_VARIANT=fork ./gradlew :app:assembleRelease \
     --no-daemon --max-workers=1 -Dorg.gradle.parallel=false
   ```

   Build all configured ABIs unless the user requests one. Log prebuild and Gradle output in task-specific temporary files. Wait for successful exits; a partial APK from a failed build is not a deliverable.

## Sign and verify

1. Locate the completed release APK under `packages/app/android/app/build/outputs/apk/release/`. Use the installed SDK's `zipalign` to align a copy, then `apksigner sign --out` to replace Expo's debug signature with the existing fork key and alias from `docs/android.md`.
2. Pass the keystore password through `--ks-pass file:<password-file>`. Omit `--key-pass` when the key uses the same password. If it differs, use a separate password file: reusing one file for both flags consumes successive lines and fails on a single-line file. Keep passwords out of commands and logs; preserve the signing files.
3. Verify with `apksigner verify --verbose --print-certs` and `zipalign -c`. Inspect APK metadata with the SDK's `aapt` or `aapt2`: package ID must be `sh.paseo.fork`, label must be `Paseo Fork`, and the version must match `packages/app/native-release-version.js` for the recorded source.
4. Put the signed APK in a dedicated temporary output directory as `Paseo-Fork-<root-version>.apk`. Record its size, SHA-256, source commit, and signing certificate fingerprint.

## Report

Return a clickable Markdown link to the verified APK first. Use its absolute file path as both the link label and target. Include the fork version, source commit, and file size. Do not start a download server.

If the build or verification fails, report the failure with its logs. Return an APK link only after signing and verification succeed.
