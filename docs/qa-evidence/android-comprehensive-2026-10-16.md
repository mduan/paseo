# Android QA ledger — 2026-10-16

## Cutoff and result

The tested code cutoff is `f55ca00df9efef507aa25cd2be022bd0f8010fb5` in `mduan/paseo`.
The comprehensive run started at `b26ee9153249ff62c9a94bc7ca8a3bc08cc41b08`.
The original fork audit compared against `d831c7bf33bbcad1835cf8e81668b8eebb97f3f4`.

This snapshot contains 32 bounded follow-up cases, not a complete inventory of all app behavior.
All 32 cases completed their retained-behavior checks.
The final preview matrix passed during a later retry with one preserved API 35 emulator.
All five P1 cases passed their recorded assertions.
Two exercised cases contain requested features that the retained product does not provide.
This record provides no coverage percentage.

The final source cutoff does not mean every case ran on APK 7.
The result combines earlier native evidence, focused regressions, later fixes, and review of affected callers.
Each case retains its last known build below. An unspecified build is not an APK 7 pass.

## Build identity

APK 7 is `candidate7-release.apk`, package `sh.paseo`.
Its SHA-256 is `58988eed357c4feb9e230525a4a83c1b134187e051804c4ca270ea3f333a8483`.
The build used `2ab5f737b4c9910ab6a9bb2a6d5cfd73f0a5ab8c` plus the frozen assistant-image frame patch.
The patch SHA-256 is `315218f0ceec11e6e73661f2038d39218c93f486407b74b01d47cfbdc0b9d5f7`.

The committed app diff matches that patch byte for byte:

```bash
git diff --src-prefix=c/ --dst-prefix=w/ 2ab5f737b f55ca00df --binary -- packages/app/src/components/message.tsx
```

[APK 7 provenance](android-comprehensive-2026-10-16/source-provenance-v7.json) records the exact source composition and native acceptance.
This establishes source correspondence. It does not establish a reproducible binary build.

Earlier APK 6 used `b6da9b1e9d2765d698d7e5cced61ba7f8cc2b506` plus the native link patch.
That patch SHA-256 is `bdc77433630fb295557ea2b828db8d61cb58926998a721e094a03855e0ef70d6`.
Its committed source was `2ab5f737b4c9910ab6a9bb2a6d5cfd73f0a5ab8c`.
[APK 6 provenance](android-comprehensive-2026-10-16/source-provenance.json) preserves that earlier match.

| Build | Last known source                                      | APK SHA-256                                                        |
| ----- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| B0    | Starting `b26ee9153`                                   | `5e68444b5ac2532aaa89e0737f6bd655e077450d1f67ee8e72e23d01f78760f9` |
| I1    | `aff792f0b`                                            | `a2cb7799effc75880cb53a0bbf0f03efc78ac215dacd23a22e9e0249de6f8ea9` |
| C1    | I1 plus staged Explorer and first anchor edits         | `f19398c487d0df44c9d6be0de076eb547a2760bf7ae091e5e86ebbc8dbb8b234` |
| C2    | I1 plus staged Explorer and intermediate anchor edits  | `fb68b158569fff59e80a787613739872ac3a580de156eb1cee9d7ed2781b31eb` |
| C3    | Final anchor fix `063921f73`                           | `06abbf7171f82c8cfd96e11751a400f37d4595510628d7288e2d1523b5e39647` |
| C4    | C3 plus native review fix `80ccae4f4`                  | `e92650561e78ad7b510dfef23a2229878b4446f4cac8bc54e23b2ff988c1d14c` |
| C5    | Compact child metadata candidate                       | `000a5b2a76cb080a2db3d6320e615f55a719c4cb59d888d55ce02564f1ba083e` |
| C6    | `2ab5f737b` (APK 6 composition)                        | `7a2d90affc5055635d11b56da3d976b4fad0d12c56774783e3b992b8533256f9` |
| C7    | Image-frame correction `f55ca00df`, exact final source | `58988eed357c4feb9e230525a4a83c1b134187e051804c4ca270ea3f333a8483` |

The Claude image fix changed the daemon. Its native repair checks used the unchanged C4 app with the rebuilt isolated daemon.
C2 failed an intermediate-frame anchor check. C3 supersedes that result, with zero displacement across 40 recorded video frames.

## Case ledger

The report column names files under `.dev/android-comprehensive-qa/`.
These paths provide local traceability. The ledger preserves the concrete assertions independently of ignored artifacts.
The final preview case combines earlier green subsets with the recorded native retry. Its queue and sent stages use separate message identities.

| Case ID                                  | Current status                           | Native build              | Concrete assertions and remaining work                                                                                                                                                                                                                                                                                                                                                                                                                                            | Report                                                        |
| ---------------------------------------- | ---------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `image-only-canonical-native`            | `passed_after_fix`                       | I1                        | Empty-text image creation produced one user, image, assistant, and turn. Automatic titles and the actual lightbox survived app cold reopen. Existing damaged-row repair also survived isolated daemon restore.                                                                                                                                                                                                                                                                    | `image-fixed/report.json`                                     |
| `native-scroll-anchoring`                | `passed_after_fix`                       | I1/C2, final C3           | An older response stayed within one pixel through send/reply. Final toggle expansion, collapse, and late rows kept the anchor unchanged. Forty final video frames showed zero displacement. Disabled preference and explicit jump returned to the bottom.                                                                                                                                                                                                                         | `chat-races/report.json`                                      |
| `native-drag-send-race`                  | `passed`                                 | I1                        | Actual lifted queue rows survived completion, edit, and Send now membership changes. Dispatched rows did not return. Provider counts stayed once each. Surviving image/order and the other chat queue stayed intact.                                                                                                                                                                                                                                                              | `chat-races/report.json`                                      |
| `review-snapshot-dirty-send`             | `passed`                                 | B0                        | Added/removed-line comments kept captured side, line, content, trees, and Unicode through dirty checkout, comparison changes, and cold reopen. Deleting L2 and editing R2 delivered only the updated captured R2 comment once.                                                                                                                                                                                                                                                    | `files/report.json`                                           |
| `native-route-deck-notification`         | `passed`                                 | B0                        | Actual warm/cold notification responses focused the existing terminal. Draft and tab ownership survived. A real same-workspace fork preserved the original draft. Slash/file menus stayed inside the viewport. One Back exposed no duplicate deck.                                                                                                                                                                                                                                | `navigation/report.json`                                      |
| `queue-pending-send-failure`             | `passed`                                 | I1/C2 staged runs         | A held canonical event and RPC acknowledgement prevented auto-drain after idle. Rejection restored the same text/image once with an error. Retry sent once. The later ambiguous acknowledgement risk remains separate.                                                                                                                                                                                                                                                            | `chat-races/report.json`                                      |
| `link-review-queued-previews`            | `passed_after_fix`                       | C4/C6, final C7/API35     | Draft, queued, and sent issue/change/generic URL sheets retained full URLs; one Back dismissed one overlay and external actions used exact targets. Queued review showed the exact Unicode body, path, and R4–R7 range. Source navigation and the native tab chooser returned to the unchanged queue. A separate restored four-attachment payload produced exactly one accepted canonical message. Prior queued-image, native selection/copy, and sent-review checks were reused. | `preview-retry/report.json`                                   |
| `question-variants-and-retry`            | `passed`                                 | C4                        | Image-only answers enabled Next/Submit. Removing the last image disabled them. Navigation retained independent answers. Fixed options cleared Other text. Upload/response errors retained state and unlocked retry. Real synchronous Claude AskUserQuestion returned uploaded file context once.                                                                                                                                                                                  | `questions-skills/report.json`                                |
| `fork-inflight-earlier-boundary`         | `passed`                                 | C4, C6 decoder acceptance | A real stream exposed Summary and disabled Full history with an explanation. Summary retained partial line 294 while the source completed 800. Earlier forks excluded the later marker and retained image/tool history. Duplicate taps, failure/retry, Continue, and generation numbering passed.                                                                                                                                                                                 | `provider-parity/report.json`, `summary-wire-fix/report.json` |
| `provider-fork-parity`                   | `passed_after_fix`                       | C4/C6, final API35        | Real Claude full-history forks preserved history, image boundary, model, mode, effort, and source state in the same workspace and a new worktree. The final new-worktree image opened in its native preview with matching bytes. Pi Summary-only and read-only child restrictions passed.                                                                                                                                                                                         | `provider-parity/report.json`                                 |
| `native-offline-cache-upgrade`           | `passed_with_limits`                     | I1                        | A blocked host could not mask offline cache loss. Costs, model, effort, turns, preview, fork text, and image reference survived cold reopen. Derived schema-1 rows and cursor cleared together. Full refill repaired metadata without duplicates or host/draft loss.                                                                                                                                                                                                              | `offline-cache/report.json`                                   |
| `real-subagents-cost-status`             | `passed_after_fix`                       | C4/C5/C6, final API35     | Real managed/native children contributed once. Descendant activity, readable compact metadata, correct tab mutability, and unavailable policy passed. Native Archive finished archived the managed child and hid the native child locally. Cold restore retained costs, model, effort, turns, global archive state, and native history.                                                                                                                                           | `provider-parity/report.json`                                 |
| `cost-states-provider-differences`       | `passed`                                 | C4/C6, final API35        | Prior totals persisted during the next turn and incremented after completion. Native zero, Unavailable, qualified Pi label, and provider-reported/estimated policies passed. Unknown managed cost excluded only that subtotal. Exact real costs, model, effort, and turns survived daemon/app cold restore.                                                                                                                                                                       | `provider-parity/report.json`                                 |
| `creation-failure-eviction`              | `passed`                                 | I1                        | An accepted request stayed pending through held Git provisioning. Before-workspace errors stopped loading and stayed dismissed after late failure. After-workspace errors belonged to the draft. Eviction completed once without a phantom draft or duplicate prompt.                                                                                                                                                                                                             | `workspace-lifecycle/report.json`                             |
| `sidebar-terminal-deferred-menu`         | `passed`                                 | B0                        | An unseen terminal menu omitted pane moves. Native paste matched its copied ID. Rename targeted the correct terminal. Mounted actions stayed available. Close other tabs retained the intended responsive terminal.                                                                                                                                                                                                                                                               | `navigation/report.json`                                      |
| `recursive-tree-root`                    | `passed`                                 | I1                        | Root Expand all exposed deep visible descendants but not hidden paths. Intermediate collapse preserved the sibling. Root collapse survived cold reopen. Root expansion restored coherent children without filesystem edits.                                                                                                                                                                                                                                                       | `explorer/report.json`                                        |
| `file-tab-deep-reveal`                   | `passed_after_fix`                       | C1                        | Search opened a deep file with uncached ancestors beyond the viewport. Reveal cleared search, closed the chooser, selected the file, and scrolled it fully onscreen. A second workspace stayed separate. Native paste matched the copied path.                                                                                                                                                                                                                                    | `explorer/report.json`                                        |
| `turn-diff-view-options`                 | `passed`                                 | C4                        | Wrap, whitespace, and collapse changed the expected native files/lines. Saved R2 identity survived layout changes. Reopen retained preferences and comment. Native controls offered no split mode.                                                                                                                                                                                                                                                                                | `review-remaining/report.json`                                |
| `cached-file-link-lines`                 | `passed`                                 | I1                        | Near line 5, far line 140, then near line 5 opened the correct visible source ranges. Exactly one file tab remained. Native target tint was outside the retained feature.                                                                                                                                                                                                                                                                                                         | `explorer/report.json`                                        |
| `shallow-success-and-base-error`         | `passed`                                 | I1                        | Native Fetch more history recovered a real shallow local repository. Committed and dirty files appeared. An invalid base produced an explicit error. Choosing the valid base recovered the diff.                                                                                                                                                                                                                                                                                  | `git-remaining/report.json`                                   |
| `changes-checkout-controls`              | `passed`                                 | I1                        | Native Changes checkout changed the actual clean Git branch, base, and shown file. Detached HEAD still permitted a real branch selection. The fixture returned clean to its original branch.                                                                                                                                                                                                                                                                                      | `git-remaining/report.json`                                   |
| `populated-usage-budgets`                | `passed_with_limits`                     | B0                        | Capped, uncapped, zero, null, resets, pins, and unavailable states passed. Pins survived cold reopen and host change. Team A refresh preserved Team B. Credential/transient errors recovered. Estimated labels are absent and remain an unmet audit expectation.                                                                                                                                                                                                                  | `usage/report.json`                                           |
| `usage-actual-auto-refresh`              | `passed`                                 | B0                        | A real five-minute interval updated the closed Usage route once. Host change stopped old-host activity. Background/resume produced one current-host burst. Manual mode made zero automatic requests for 350 seconds. Explicit refresh updated the card.                                                                                                                                                                                                                           | `usage/report.json`                                           |
| `older-host-capability-ui`               | `passed`                                 | C3                        | Legacy, intermediate, current, and mixed capability sets preserved supported History semantics. Unsupported controls showed guidance. Ordinary search remained usable. Same-identity downgrade/upgrade retained the mounted query and recovered results.                                                                                                                                                                                                                          | `settings-compat/report.json`                                 |
| `host-update-native-feedback`            | `passed_with_limits`                     | C3                        | Confirmation, progress, duplicate blocking, version/PID replacement, and real socket reconnect passed. Rejected, failed, and actual five-minute update/eleven-minute restart timeout paths unlocked retry. Managed/unsupported states explained or omitted actions. The package updater itself was not executed.                                                                                                                                                                  | `settings-compat/report.json`                                 |
| `metadata-settings-and-rename-failures`  | `passed`                                 | C3                        | A model without thinking options omitted stale effort. Automatic persisted after cold reopen. Rejected configuration retained authoritative values and an error. Rename failure retained the prior title, ended pending state, and allowed successful retry.                                                                                                                                                                                                                      | `settings-compat/report.json`                                 |
| `concurrent-worktree-archive`            | `passed`                                 | I1                        | Two native archive requests overlapped by 2.095 seconds. Each owned worktree disappeared once. Git removal serialized correctly. The unrelated checkout survived. App cold reopen and WebSocket reconnect restored neither archived workspace nor stranded locks/spinners.                                                                                                                                                                                                        | `workspace-lifecycle/report.json`                             |
| `draft-skills-refresh`                   | `passed`                                 | C4                        | Actual Codex discovery refreshed a retained draft after 210 seconds and New workspace after 114 seconds. Host/provider/project changes removed stale commands. Menus stayed above Gboard. Exactly the selected project skill reached the correct session once.                                                                                                                                                                                                                    | `questions-skills/report.json`                                |
| `native-hidden-turn-layout-images-links` | `passed_after_fix`                       | C6/C7, final API35        | Hidden turns kept one owned 3s/2s footer through steer/fork markers. Live and cold seams stayed unique after two genuine older pages. Native URL copy/tap passed. C7 small/wide/tall bitmaps and frames obeyed natural-width/height caps; lightbox enlarged and close preserved the reading anchor.                                                                                                                                                                               | `previews-layout/report.json`                                 |
| `review-long-input-preview-open`         | `passed_after_fix`                       | C4                        | Real Gboard permitted the last edit of 20 Unicode lines. Save/Delete stayed above the keyboard. The saved card stayed bounded. Preview retained all text. Its file link opened the captured range and dismissed the overlay.                                                                                                                                                                                                                                                      | `review-remaining/report.json`                                |
| `history-combined-search-recents`        | `executed_with_unmet_audit_expectations` | C4                        | Combined Unicode/regex/case/whole-word rows and highlights matched exact expectations. Invalid regex recovered. Native selection, deduplication, the 100-entry cap, cold persistence, and option reset passed. Recent-list Remove/Clear controls are absent.                                                                                                                                                                                                                      | `history-sidebar/report.json`                                 |
| `sidebar-persistence-live-counts`        | `passed`                                 | C4                        | Host/project/status grouping and count preference survived cold reopen. Native creation/archive changed the selected project count 1→2→1. Other counts stayed unchanged. One offscreen intermediate count used API evidence.                                                                                                                                                                                                                                                      | `history-sidebar/report.json`                                 |

## Nine fixes

| Commit                                     | Retained correction                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `aff792f0b52d04a75b5ad422ceb2bec156b41b82` | Canonical prompt media survives merge and cold cache restore. Schema 3 repairs incomplete derived rows. |
| `8b52276fe4bb7b55b0200bf0bb5a4742f9d3c2bf` | Reveal clears Files search, loads ancestors, selects the deep file, and closes the compact chooser.     |
| `063921f736ca41dc055ae7c81b8d0673339bfe35` | Native work toggles retain their screen position through layout.                                        |
| `80ccae4f485a23959446fda1afc541b54fffa275` | Native review content provides enough scroll space for keyboard-visible Save/Delete.                    |
| `78fd677e9f038321c7c18227c417798312dcf12e` | Claude live and restored user messages retain inline images.                                            |
| `6c6a9d7ff9ef8a9ca8b4d708991104ae18c0e8ee` | Compact child rows show metadata below the title and clear of actions.                                  |
| `b6da9b1e9d2765d698d7e5cced61ba7f8cc2b506` | A structural text attachment schema permits generated summary decoding.                                 |
| `2ab5f737b4c9910ab6a9bb2a6d5cfd73f0a5ab8c` | Native link long-selection no longer activates the URL on release.                                      |
| `f55ca00df9efef507aa25cd2be022bd0f8010fb5` | Native assistant-image frames use the capped parent width before aspect sizing.                         |

## Recorded automated results

These results reuse completed targeted runs. This ledger preparation ran no tests.
The prior handoff recorded 3,495 automated passes and six skips. That total does not prove native completeness.
The table records suite results, not an additional unique-test total. Green reruns do not count as new tests.

| Existing suite or command                                                                                                            | Recorded result                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/runtime/replica-cache/index.test.ts`                                                                               | 31 passed, including two new canonical-media arrival-order cases.                                                                  |
| `packages/app/src/types/stream.test.ts`                                                                                              | 68 passed.                                                                                                                         |
| `packages/app/src/runtime/replica-cache/row-store.native.test.ts` and `packages/app/src/runtime/replica-cache/row-store.web.test.ts` | Two selected cases passed.                                                                                                         |
| `packages/app/src/agent-stream/collapse-completed-turns.test.ts`                                                                     | Eight passed.                                                                                                                      |
| `packages/app/src/agent-stream/strategy-web.test.tsx`                                                                                | 17 passed.                                                                                                                         |
| `packages/app/e2e/browser/file-editing.spec.ts`                                                                                      | One new compact deep-reveal regression failed before the fix and passed afterward.                                                 |
| `packages/server/src/server/agent/providers/claude/agent.test.ts`                                                                    | 92 passed, including four new live/restored user-image cases.                                                                      |
| `packages/protocol/tests/validation/ws-outbound.test.ts` and `packages/protocol/src/messages.attachments.test.ts`                    | 25 passed. The generated summary assertion failed before the schema fix.                                                           |
| `plugins/claude-usage-source/server/usage.test.ts`                                                                                   | 53 passed.                                                                                                                         |
| `plugins/codex-usage-source/server/usage.test.ts`                                                                                    | 20 passed.                                                                                                                         |
| `plugins/litellm-usage-source/server/usage.test.ts`                                                                                  | 13 passed. Initial sandbox listen denial did not count as a product failure.                                                       |
| Workspace declaration builds                                                                                                         | `npm run build:client` and `npm run build:server` passed before cross-package type diagnosis.                                      |
| Required implementation commands                                                                                                     | Each fix recorded passing `npm run format`, `npm run typecheck`, `npm run lint`, and normal commit hooks. No full local suite ran. |
| `packages/app/e2e/browser/agent-tab-image-stability.spec.ts`                                                                         | One existing lightbox case passed after the image-frame change. No new style-mirror unit test was added.                           |
| Final review                                                                                                                         | Independent source review found no actionable source regression. Evidence review reconciled the two absent feature groups.         |

The summary decoder also accepted the retained original live frame through the built client.
APK 6 showed that same summary on the unchanged isolated backend.
The link fix passed native sheet/user-bubble selection, exact copy, and the normal-tap target before commit.
The image matrix passed native C7 geometry and anchor checks. The final preview retry also passed on C7.
Its host loaded `fe0a4cef01d977c61f0fa659f41d308c0841999f`; app and server source match the tested code cutoff.

## Limits and retained risks

The final preview retry used one preserved API 35 emulator, APK 7, and the same isolated host home.
Queue previews and source return passed before an intentional edit.
Editing a queued message omits its review snapshot, matching the branch-base helper and explicit test.
The sent-stage fixture restored that snapshot after completing the queue assertions.
Seven earlier requests were rejected while the controlled SDK remained held after cancellation; none produced a canonical attachment message.
The final native send used a new identity and produced one accepted canonical message.
Queued and sent stages are composed evidence; automatic delivery of the original queue is outside this check.
External target checks use fresh Android VIEW receipts. Browser onboarding and remote page loading are outside their scope.

Two requested feature groups remain unmet: estimated usage labels and Recent Search Remove/Clear controls.
The retained usage schema has no estimated flag. Unavailable usage remains distinct from zero.
Recent searches support selection, deduplication, persistence, and a 100-entry cap.
No new feature was added to satisfy either absent audit expectation.

Fork title numbers encode generation depth. Two sibling forks can share the same number.
Provider-native child hiding resets after app cold reopen. Its history remains intact; managed-child archive state persists globally.
Provider-native observation timestamps rebuild after daemon restore. Their model, recorded effort, costs, and timeline stayed unchanged.

A pre-existing queued RPC policy can restore a message after execution succeeds but its acknowledgement times out.
Retry with a fresh identity can repeat work. No receipt-query API exists.
The controlled rejection/retry pass does not establish safe retry after every ambiguous acknowledgement.

Schema 3 invalidates derived history rows and their cursor together.
An online refill is required before old history becomes available offline. Host records and unsent drafts live outside that database.
The schema-1 upgrade used explicitly derived historical data. It did not install an old signed phone APK.

Native evidence uses isolated ARM64 Google APIs emulators, mainly API 36, with later API 35 attempts.
Physical phones, Samsung OneUI, hardware behavior, phone signing, and real APK upgrade compatibility were not tested.
Gboard checks apply only to the recorded emulator runs. Route autocomplete geometry used a hidden keyboard.
FCM transport and credentials were excluded. Notification tests exercised actual Android notifications and Expo response callbacks.

Controlled SDK fixtures exercised queue, workspace, search, configuration, lifecycle, and preview states.
Real Git operations, native surfaces, SQLite, and recorded gestures remained real in those fixtures.
Provider checks separately used actual Claude, Codex, and Pi sessions on owned isolated hosts.
Usage checks used real plugin parsers with fixture credentials and responses, not production credential stores or external accounts.
Lifecycle checks used controlled PID/version responses and real socket reconnect, not package installation or supervisor replacement.

Emulators showed capture/UI stalls and a recorded 84.975-second activity display delay.
The initiating cause and source attribution remain unclassified. Successful shell reads do not prove a usable native surface.
Fresh userdata, GuestAngle changes, and API 35 initial readiness did not establish sustained stability.
Further recovery used scoped emulator restarts, following the request to limit instability debugging.
The later single-emulator retry completed the preview matrix after ordinary settle/capture retries.
Chrome showed an ANR during external-link handling. Native previews and fresh Android VIEW receipts remained verifiable.
These observations do not establish whether concurrent emulators contributed to earlier stalls.

Tall-image height uses both visible edge captures, its 192-pixel width, and the undistorted 320×1600 source aspect.
One viewport cannot show its full 960-pixel height. Pagination covered two actual 40-entry older pages, without exhausting all history.
These results do not establish that a renderer or API version fixes the instability.

No physical-phone change, production daemon restart, shared Codex QA, push, or release formed part of this run.
Original AVD userdata, fixture homes, and earlier failed evidence remain preserved.

## Durable evidence

These selected raw outputs and screenshots accompany this record:

| Artifact                                                                                                                                                                                                                                     | Evidence                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [Source provenance](android-comprehensive-2026-10-16/source-provenance.json)                                                                                                                                                                 | Committed `2ab5f737b` matches the frozen APK 6 patch.                                                               |
| [Image-only assertions](android-comprehensive-2026-10-16/image-only.json)                                                                                                                                                                    | One canonical image-only first turn, automatic titles, model, and effort.                                           |
| [Settled anchor](android-comprehensive-2026-10-16/anchor-settled.json) and [video measurements](android-comprehensive-2026-10-16/anchor-video.json)                                                                                          | Zero displacement through the final toggle and all 40 video frames.                                                 |
| [Summary decoder output](android-comprehensive-2026-10-16/summary-decoder.txt)                                                                                                                                                               | Source schema, generated validator, and built client accept the retained live frame.                                |
| [Compact metadata output](android-comprehensive-2026-10-16/compact-child-metadata.txt) and [screenshot](android-comprehensive-2026-10-16/compact-child-metadata.png)                                                                         | Real child metadata remains below the title and clear of actions.                                                   |
| [Copied URL](android-comprehensive-2026-10-16/link-copy.json) and [normal-tap target](android-comprehensive-2026-10-16/link-target.json)                                                                                                     | Native copy preserves the complete URL. A normal tap excludes closing punctuation.                                  |
| [Assistant-frame measurements](android-comprehensive-2026-10-16/assistant-image-frames.json), [before](android-comprehensive-2026-10-16/assistant-frame-before.png), and [after](android-comprehensive-2026-10-16/assistant-frame-after.png) | Native small-image frame shrinks from 200dp to its natural 40dp height. Wide control and lightbox/anchor pass.      |
| [Tall top](android-comprehensive-2026-10-16/assistant-tall-top.png) and [bottom](android-comprehensive-2026-10-16/assistant-tall-bottom.png)                                                                                                 | Both frame edges meet the bitmap. Measured width and source aspect establish the 480dp height cap.                  |
| [Provider cold assertions](android-comprehensive-2026-10-16/provider-cold-family.json)                                                                                                                                                       | Costs, model, effort, turns, managed archive state, and native history survive daemon/app cold restore.             |
| [Claude worktree assertions](android-comprehensive-2026-10-16/claude-new-worktree.json) and [native preview](android-comprehensive-2026-10-16/claude-new-worktree-image.png)                                                                 | The new-worktree fork retains exact image bytes, earlier history, configuration, and source state.                  |
| [Final preview assertions](android-comprehensive-2026-10-16/preview-final.json), [queue after source return](android-comprehensive-2026-10-16/queue-return.png), and [sent URL sheet](android-comprehensive-2026-10-16/sent-url-sheet.png)   | URL stage checks, unchanged queue, exact canonical payload, fixture composition, and cleanup.                       |
| [Queued review subset](android-comprehensive-2026-10-16/queued-review-subset.png)                                                                                                                                                            | The queued sheet shows the exact Unicode body, path, and R4–R7 range. The later return assertion is recorded above. |
| [Cold image lightbox](android-comprehensive-2026-10-16/image-cold-lightbox.png)                                                                                                                                                              | The actual image remains visible after cold reopen.                                                                 |

The bundle contains task-owned fixture data. APK binaries, databases, backups, full logcat, and provider rollouts remain local.

## Reuse results

If a relevant component changes, rerun the affected cases rather than the entire ledger.
Relevant changes include provider SDKs, protocol validation, cache schema, queue state, native layout, link gestures, and startup routing.
A changed runtime, emulator image, renderer, or signing path requires new evidence for claims that depend on it.
An unrelated documentation edit does not invalidate recorded native behavior.

If an existing green run matches the required behavior and build context, reuse its evidence and record that reuse.
Keep the exact build, fixture scope, accepted assertions, and exclusions with each result.
Do not count fixture preparation, timed-out capture, initial splash, or backend-only state as a native UI pass.
