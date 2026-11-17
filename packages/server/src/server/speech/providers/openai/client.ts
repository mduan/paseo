import type { OpenAI } from "openai";

// The openai SDK is large, so it loads on the first request instead of at daemon startup.
export function createLazyOpenAIClient(options: {
  apiKey: string;
  baseUrl?: string;
}): () => Promise<OpenAI> {
  let client: Promise<OpenAI> | undefined;
  return () => {
    client ??= import("openai").then(
      ({ OpenAI }) =>
        new OpenAI({
          apiKey: options.apiKey,
          ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
        }),
    );
    return client;
  };
}
