import assert from "node:assert/strict";
import test from "node:test";
import { nextForkVersion } from "./bump-fork-version.mjs";

test("advances the fork number", () => {
  assert.equal(nextForkVersion("0.11.0-fork.1"), "0.11.0-fork.2");
  assert.equal(nextForkVersion("0.11.0-fork.9"), "0.11.0-fork.10");
});

test("rejects non-fork versions", () => {
  assert.throws(() => nextForkVersion("0.11.0-beta.3"), /not a fork version/);
});
