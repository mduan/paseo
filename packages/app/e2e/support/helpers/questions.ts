import { expect, type Page } from "@playwright/test";
import { loadSessionMessageReaders } from "./new-workspace";

export async function waitForQuestionPrompt(page: Page, timeout = 30_000): Promise<void> {
  await expect(page.getByTestId("question-form-card").first()).toBeVisible({ timeout });
}

export async function expectCurrentQuestion(
  page: Page,
  input: { index: number; total: number; question: string },
): Promise<void> {
  const card = page.getByTestId("question-form-card").first();
  await expect(card.getByTestId("question-form-current-question")).toHaveText(input.question);
  // Nav tabs only render for multi-question cards (hidden for a lone question).
  if (input.total > 1) {
    await expect(questionNavTab(page, input)).toHaveAttribute("aria-selected", "true");
  }
}

export async function expectQuestionHidden(page: Page, question: string): Promise<void> {
  await expect(page.getByText(question, { exact: true })).toHaveCount(0);
}

// Options render as radios (single-select) or checkboxes (multi-select), so match
// either role by accessible name.
function questionOption(page: Page, option: string) {
  const card = page.getByTestId("question-form-card").first();
  return card.getByRole("radio", { name: option }).or(card.getByRole("checkbox", { name: option }));
}

// The multi-question nav renders as a tablist; each question is a tab.
function questionNavTab(page: Page, input: { index: number; total: number }) {
  return page
    .getByTestId("question-form-card")
    .first()
    .getByRole("tab", { name: `Question ${input.index} of ${input.total}` });
}

export async function chooseQuestionOption(page: Page, option: string): Promise<void> {
  await questionOption(page, option).click();
}

export async function expectQuestionOptionSelected(page: Page, option: string): Promise<void> {
  await expect(questionOption(page, option)).toHaveAttribute("aria-checked", "true");
}

export async function openQuestion(
  page: Page,
  input: { index: number; total: number },
): Promise<void> {
  await questionNavTab(page, input).click();
}

export async function expectQuestionNavigationEnabled(
  page: Page,
  input: { index: number; total: number },
): Promise<void> {
  await expect(questionNavTab(page, input)).toBeEnabled();
}

export async function fillQuestionAnswer(
  page: Page,
  input: { question: string; answer: string },
): Promise<void> {
  await page
    .getByTestId("question-form-card")
    .first()
    .getByRole("textbox", { name: input.question })
    .fill(input.answer);
}

export async function submitQuestionAnswers(page: Page): Promise<void> {
  await page.getByTestId("question-form-primary-action").click();
  await expect(page.getByTestId("question-form-card")).toHaveCount(0, { timeout: 30_000 });
}

export async function expectQuestionPrimaryActionEnabled(page: Page, label: string): Promise<void> {
  await expect(
    page.getByTestId("question-form-card").first().getByRole("button", { name: label }),
  ).toBeEnabled();
}

export async function expectQuestionPrimaryActionDisabled(
  page: Page,
  label: string,
): Promise<void> {
  await expect(
    page.getByTestId("question-form-card").first().getByRole("button", { name: label }),
  ).toBeDisabled();
}

export async function expectQuestionDismissEnabled(page: Page): Promise<void> {
  await expect(
    page.getByTestId("question-form-card").first().getByRole("button", { name: "Dismiss" }),
  ).toBeEnabled();
}

export async function continueToNextQuestion(page: Page): Promise<void> {
  await page
    .getByTestId("question-form-card")
    .first()
    .getByRole("button", { name: "Next" })
    .click();
}

export async function observeQuestionAnswers(page: Page) {
  const frames = await loadSessionMessageReaders();
  let answers: unknown;
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const request = frames.client(payload);
      if (request?.type === "agent_permission_response" && request.response.behavior === "allow") {
        answers = request.response.updatedInput?.answers;
      }
    });
  });
  return () => answers;
}

export async function pasteQuestionImage(
  page: Page,
  input: { question: string; base64: string },
): Promise<void> {
  await page
    .getByTestId("question-form-card")
    .getByRole("textbox", { name: input.question })
    .evaluate((element, base64) => {
      const transfer = new DataTransfer();
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      transfer.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
      element.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }),
      );
    }, input.base64);
}

export async function clearQuestionImageBytes(page: Page): Promise<void> {
  const database = await page.evaluateHandle(
    () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("paseo-attachment-bytes", 1);
        request.addEventListener("success", () => resolve(request.result), { once: true });
        request.addEventListener("error", () => reject(request.error), { once: true });
      }),
  );
  try {
    await database.evaluate(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const transaction = db.transaction("attachments", "readwrite");
          transaction.objectStore("attachments").clear();
          transaction.addEventListener("complete", () => resolve(), { once: true });
          transaction.addEventListener("error", () => reject(transaction.error), { once: true });
        }),
    );
  } finally {
    await database.evaluate((db) => db.close());
    await database.dispose();
  }
}
