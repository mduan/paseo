import { readFile } from "node:fs/promises";
import {
  attachImageFromMenu,
  attachFileFromMenu,
  controlFileUploadCompletion,
  removeAttachmentPill,
} from "../support/helpers/composer";
import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import {
  chooseQuestionOption,
  continueToNextQuestion,
  expectCurrentQuestion,
  expectQuestionDismissEnabled,
  expectQuestionHidden,
  expectQuestionNavigationEnabled,
  expectQuestionOptionSelected,
  expectQuestionPrimaryActionDisabled,
  expectQuestionPrimaryActionEnabled,
  fillQuestionAnswer,
  openQuestion,
  observeQuestionAnswers,
  pasteQuestionImage,
  clearQuestionImageBytes,
  submitQuestionAnswers,
  waitForQuestionPrompt,
} from "../support/helpers/questions";

const TOTAL_QUESTIONS = 3;
const SURFACE_QUESTION = "Which surface should this apply to?";
const ROLLOUT_QUESTION = "Which rollout should we use?";
const SUCCESS_QUESTION = "What success criteria should we use?";
const REPO_URL_QUESTION = "What is the GitHub private repo URL to push to?";
const COMMIT_MESSAGE_QUESTION = "What should the first commit message be?";

const TEST_IMAGE = {
  name: "example.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
};

test.describe("Question prompt pagination", () => {
  test("shows one question at a time with numbered navigation", async ({ page }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "question-pagination-",
      title: "Question pagination e2e",
      initialPrompt: "Emit synthetic questions.",
    });

    try {
      await openAgentRoute(page, session);
      await waitForQuestionPrompt(page, 120_000);

      await expectCurrentQuestion(page, {
        index: 1,
        total: TOTAL_QUESTIONS,
        question: SURFACE_QUESTION,
      });
      await expectQuestionHidden(page, ROLLOUT_QUESTION);
      await expectQuestionHidden(page, SUCCESS_QUESTION);

      await chooseQuestionOption(page, "App");
      await expectCurrentQuestion(page, {
        index: 2,
        total: TOTAL_QUESTIONS,
        question: ROLLOUT_QUESTION,
      });

      await openQuestion(page, { index: 1, total: TOTAL_QUESTIONS });
      await expectCurrentQuestion(page, {
        index: 1,
        total: TOTAL_QUESTIONS,
        question: SURFACE_QUESTION,
      });
      await expectQuestionOptionSelected(page, "App");

      await openQuestion(page, { index: 2, total: TOTAL_QUESTIONS });
      await chooseQuestionOption(page, "Behind feature flag");
      await expectCurrentQuestion(page, {
        index: 3,
        total: TOTAL_QUESTIONS,
        question: SUCCESS_QUESTION,
      });

      await fillQuestionAnswer(page, {
        question: SUCCESS_QUESTION,
        answer: "Only one prompt is visible at a time.",
      });
      await submitQuestionAnswers(page);
    } finally {
      await session.cleanup();
    }
  });

  test("free-write questions use Next before final Submit", async ({ page }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "question-free-write-",
      title: "Question free-write e2e",
      initialPrompt: "Emit synthetic questions: two free-write questions.",
    });

    try {
      await openAgentRoute(page, session);
      await waitForQuestionPrompt(page, 120_000);

      await expectCurrentQuestion(page, {
        index: 1,
        total: 2,
        question: REPO_URL_QUESTION,
      });

      await fillQuestionAnswer(page, {
        question: REPO_URL_QUESTION,
        answer: "git@github.com:user/private-repo.git",
      });

      await expectQuestionPrimaryActionEnabled(page, "Next");
      await expectQuestionDismissEnabled(page);
      await expectQuestionNavigationEnabled(page, { index: 2, total: 2 });

      await continueToNextQuestion(page);
      await expectCurrentQuestion(page, {
        index: 2,
        total: 2,
        question: COMMIT_MESSAGE_QUESTION,
      });
      await expectQuestionPrimaryActionDisabled(page, "Submit");

      await fillQuestionAnswer(page, {
        question: COMMIT_MESSAGE_QUESTION,
        answer: "Initialize private repo",
      });
      await expectQuestionPrimaryActionEnabled(page, "Submit");
      await submitQuestionAnswers(page);
    } finally {
      await session.cleanup();
    }
  });

  test("keeps image and file attachments with their question and sends readable host paths", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const upload = await controlFileUploadCompletion(page);
    const answers = await observeQuestionAnswers(page);
    const session = await seedMockAgentWorkspace({
      repoPrefix: "question-attachments-",
      title: "Question attachments",
      initialPrompt: "Emit synthetic questions: two free-write questions.",
    });
    const file = {
      name: "notes.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"expected":"fixed"}'),
    };
    try {
      await openAgentRoute(page, session);
      await waitForQuestionPrompt(page);
      const card = page.getByTestId("question-form-card");
      await attachImageFromMenu(page, TEST_IMAGE);
      await expect(card.getByTestId("composer-image-attachment-pill")).toHaveCount(1);
      await pasteQuestionImage(page, {
        question: REPO_URL_QUESTION,
        base64: TEST_IMAGE.buffer.toString("base64"),
      });
      await expect(card.getByTestId("composer-image-attachment-pill")).toHaveCount(2);
      await expectQuestionPrimaryActionEnabled(page, "Next");
      await continueToNextQuestion(page);
      await expect(card.getByTestId("composer-image-attachment-pill")).toHaveCount(0);
      upload.hold();
      await attachFileFromMenu(page, file);
      await upload.waitForUpload();
      await expectQuestionPrimaryActionDisabled(page, "Submit");
      await expect(card.getByTestId("question-form-dismiss")).toBeDisabled();
      await expect(card.getByRole("tab").first()).toBeDisabled();
      upload.complete();
      await expect(card.getByTestId("composer-file-attachment-pill")).toContainText(file.name);
      await openQuestion(page, { index: 1, total: 2 });
      await expect(card.getByTestId("composer-image-attachment-pill")).toHaveCount(2);
      await openQuestion(page, { index: 2, total: 2 });
      await fillQuestionAnswer(page, {
        question: COMMIT_MESSAGE_QUESTION,
        answer: "See the attached notes",
      });
      await page.screenshot({ path: "/tmp/qa-card-attachments.png", fullPage: true });
      await submitQuestionAnswers(page);
      await expect.poll(answers).toMatchObject({
        repoUrl: expect.stringContaining("MIME: image/png"),
        commitMessage: expect.stringContaining("See the attached notes"),
      });
      const submitted = answers() as Record<string, string>;
      expect(submitted.repoUrl).not.toContain(file.name);
      expect(submitted.commitMessage).not.toContain("image/png");
      const imagePaths = [...submitted.repoUrl.matchAll(/^Path: (.+)$/gm)].map((match) => match[1]);
      expect(imagePaths).toHaveLength(2);
      for (const imagePath of imagePaths)
        expect(await readFile(imagePath)).toEqual(TEST_IMAGE.buffer);
      const filePath = /^Path: (.+)$/m.exec(submitted.commitMessage)?.[1];
      if (!filePath) throw new Error("QA answer did not include the uploaded file path");
      expect(await readFile(filePath)).toEqual(file.buffer);
      await expect(page.getByRole("textbox", { name: "Message agent..." })).toHaveValue("");
    } finally {
      await session.cleanup();
    }
  });

  test("keeps the answer after an image read failure and allows retry", async ({ page }) => {
    const answers = await observeQuestionAnswers(page);
    const session = await seedMockAgentWorkspace({
      repoPrefix: "question-retry-",
      title: "Question attachment retry",
      initialPrompt: "Emit synthetic questions: provider.",
    });
    try {
      await openAgentRoute(page, session);
      await waitForQuestionPrompt(page);
      const card = page.getByTestId("question-form-card");
      await fillQuestionAnswer(page, { question: "Which provider?", answer: "OpenCode" });
      await attachImageFromMenu(page, TEST_IMAGE);
      await expect(card.getByTestId("composer-image-attachment-pill")).toBeVisible();
      await clearQuestionImageBytes(page);
      await card.getByTestId("question-form-primary-action").click();
      await expect(card.getByRole("alert")).toContainText("was not found in IndexedDB");
      await expect(card.getByRole("textbox")).toHaveValue("OpenCode");
      await expect(card.getByTestId("composer-image-attachment-pill")).toBeVisible();
      await expectQuestionPrimaryActionEnabled(page, "Submit");
      expect(answers()).toBeUndefined();
      await removeAttachmentPill(page, "composer-image-attachment-pill", "Remove image attachment");
      await submitQuestionAnswers(page);
      await expect.poll(answers).toEqual({ Provider: "OpenCode" });
    } finally {
      await session.cleanup();
    }
  });

  for (const textFirst of [false, true]) {
    test(`multi-select keeps options and text when ${textFirst ? "text" : "options"} are entered first`, async ({
      page,
    }) => {
      const answers = await observeQuestionAnswers(page);
      const session = await seedMockAgentWorkspace({
        repoPrefix: "question-multi-",
        title: "Multi-select question",
        initialPrompt: "Emit synthetic questions: fruits.",
      });
      try {
        await openAgentRoute(page, session);
        await waitForQuestionPrompt(page);
        const fill = () =>
          fillQuestionAnswer(page, { question: "Which fruits do you like?", answer: "durian" });
        if (textFirst) await fill();
        await chooseQuestionOption(page, "Apple");
        await chooseQuestionOption(page, "Cherry");
        if (!textFirst) await fill();
        await expect(page.getByTestId("question-form-card").getByRole("textbox")).toHaveValue(
          "durian",
        );
        await submitQuestionAnswers(page);
        await expect.poll(answers).toEqual({ Fruits: "Apple, Cherry, durian" });
      } finally {
        await session.cleanup();
      }
    });

    test(`single-select replaces ${textFirst ? "text with an option" : "an option with text"}`, async ({
      page,
    }) => {
      const answers = await observeQuestionAnswers(page);
      const session = await seedMockAgentWorkspace({
        repoPrefix: "question-single-",
        title: "Single-select question",
        initialPrompt: "Emit synthetic questions: provider.",
      });
      try {
        await openAgentRoute(page, session);
        await waitForQuestionPrompt(page);
        const fill = () =>
          fillQuestionAnswer(page, { question: "Which provider?", answer: "OpenCode" });
        if (textFirst) await fill();
        await chooseQuestionOption(page, "Codex");
        if (!textFirst) await fill();
        await expect(page.getByTestId("question-form-card").getByRole("textbox")).toHaveValue(
          textFirst ? "" : "OpenCode",
        );
        await submitQuestionAnswers(page);
        await expect.poll(answers).toEqual({ Provider: textFirst ? "Codex" : "OpenCode" });
      } finally {
        await session.cleanup();
      }
    });
  }
});
