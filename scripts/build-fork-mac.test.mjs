import assert from "node:assert/strict";
import { test } from "node:test";
import { canReuseServerBuild } from "./build-fork-mac.mjs";

test("reuses the server build only for the clean commit that produced it", () => {
  assert.equal(canReuseServerBuild({ head: "abc", stamp: { head: "abc" } }), true);
  assert.equal(canReuseServerBuild({ head: "def", stamp: { head: "abc" } }), false);
  assert.equal(canReuseServerBuild({ head: undefined, stamp: { head: "abc" } }), false);
  assert.equal(canReuseServerBuild({ head: "abc", stamp: undefined }), false);
});
