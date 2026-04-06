export const AI_BACKENDS = ["claude", "ollama"] as const;

export type AiBackend = typeof AI_BACKENDS[number];

export const DEFAULT_AI_BACKEND: AiBackend = "claude";
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "gemma4:31b";

export function isAiBackend(value: unknown): value is AiBackend {
  return typeof value === "string" && AI_BACKENDS.includes(value as AiBackend);
}
