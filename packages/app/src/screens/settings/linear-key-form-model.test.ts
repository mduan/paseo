import { expect, test } from "vitest";
import { openLinearKeyForm } from "./linear-key-form-model";

test("keeps the draft while toggling visibility and rejects blank submissions", () => {
  const form = openLinearKeyForm();
  expect(form.getState()).toEqual({ apiKey: "", isVisible: false, canSubmit: false });
  form.setApiKey("   ");
  expect(form.getState().canSubmit).toBe(false);
  form.setApiKey("secret");
  form.toggleVisibility();
  expect(form.getState()).toEqual({ apiKey: "secret", isVisible: true, canSubmit: true });
  form.toggleVisibility();
  expect(form.getState()).toEqual({ apiKey: "secret", isVisible: false, canSubmit: true });
});

test("closing clears the key and detaches subscribers", () => {
  const form = openLinearKeyForm();
  let changes = 0;
  form.subscribe(() => {
    changes += 1;
  });
  form.setApiKey("secret");
  expect(changes).toBe(1);
  form.close();
  expect(form.getState()).toEqual({ apiKey: "", isVisible: false, canSubmit: false });
  form.setApiKey("another");
  expect(changes).toBe(1);
});
