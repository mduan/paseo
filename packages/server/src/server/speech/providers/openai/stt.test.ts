import pino from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";

const { openAiConstructorOptionsMock, transcriptionsCreateMock } = vi.hoisted(() => ({
  openAiConstructorOptionsMock: vi.fn(),
  transcriptionsCreateMock: vi.fn(),
}));

vi.mock("openai", () => ({
  OpenAI: vi.fn(function OpenAI(options: unknown) {
    openAiConstructorOptionsMock(options);
    return {
      audio: {
        transcriptions: {
          create: transcriptionsCreateMock,
        },
      },
    };
  }),
}));

import { OpenAISTT } from "./stt.js";

// Drains the upload before the provider deletes its temp file.
async function readFileAndTranscribe(request: { file: NodeJS.ReadableStream }) {
  await new Promise<void>((resolve, reject) => {
    request.file.once("error", reject);
    request.file.once("end", resolve);
    request.file.resume();
  });
  return { text: "hello" };
}

async function transcribeOnce(provider: OpenAISTT, prompt?: string): Promise<string> {
  const session = provider.createSession({
    logger: pino({ level: "silent" }),
    language: "en",
    prompt,
  });

  const transcript = new Promise<string>((resolve, reject) => {
    session.on("transcript", (event) => {
      if (event.isFinal) {
        resolve(event.transcript);
      }
    });
    session.on("error", (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });

  await session.connect();
  session.appendPcm16(Buffer.from([0, 0, 0, 0]));
  session.commit();
  return transcript;
}

describe("OpenAISTT", () => {
  afterEach(() => {
    openAiConstructorOptionsMock.mockReset();
    transcriptionsCreateMock.mockReset();
  });

  test("passes configured baseUrl to the OpenAI client", async () => {
    transcriptionsCreateMock.mockImplementation(readFileAndTranscribe);
    const provider = new OpenAISTT(
      { apiKey: "sk-test", baseUrl: "https://speech.example.com/v1" },
      pino({ level: "silent" }),
    );

    expect(provider.id).toBe("openai");
    await expect(transcribeOnce(provider)).resolves.toBe("hello");
    expect(openAiConstructorOptionsMock).toHaveBeenCalledWith({
      apiKey: "sk-test",
      baseURL: "https://speech.example.com/v1",
    });
  });

  test("passes transcription prompt to OpenAI REST STT", async () => {
    transcriptionsCreateMock.mockImplementation(readFileAndTranscribe);

    const provider = new OpenAISTT(
      { apiKey: "sk-test", model: "gpt-4o-transcribe" },
      pino({ level: "silent" }),
    );

    await expect(transcribeOnce(provider, "Only transcribe the speaker.")).resolves.toBe("hello");
    expect(transcriptionsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        language: "en",
        model: "gpt-4o-transcribe",
        prompt: "Only transcribe the speaker.",
        response_format: "json",
      }),
    );
  });
});
