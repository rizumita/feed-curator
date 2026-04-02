import { describe, expect, test } from "vitest";
import { normalizeTag, normalizeTags } from "./tag";

describe("normalizeTag", () => {
  test("lowercases and trims", () => {
    expect(normalizeTag("  LLM  ")).toBe("llm");
  });

  test("replaces spaces with hyphens", () => {
    expect(normalizeTag("local models")).toBe("local-models");
  });

  test("resolves synonyms", () => {
    expect(normalizeTag("llms")).toBe("llm");
    expect(normalizeTag("AI-Agents")).toBe("agents");
    expect(normalizeTag("programming")).toBe("coding");
    expect(normalizeTag("large-language-models")).toBe("llm");
    expect(normalizeTag("model-context-protocol")).toBe("mcp");
  });

  test("passes through unknown tags unchanged", () => {
    expect(normalizeTag("multimodal")).toBe("multimodal");
    expect(normalizeTag("fine-tuning")).toBe("fine-tuning");
  });

  // Regression: PBT found prototype property names returning functions
  test("handles JS prototype property names safely", () => {
    expect(normalizeTag("constructor")).toBe("constructor");
    expect(normalizeTag("toString")).toBe("tostring");
    expect(normalizeTag("hasOwnProperty")).toBe("hasownproperty");
    expect(normalizeTag("__proto__")).toBe("__proto__");
  });
});

describe("normalizeTags", () => {
  test("normalizes comma-separated tags", () => {
    expect(normalizeTags("LLMs, coding, multimodal")).toBe("llm, coding, multimodal");
  });

  test("deduplicates after normalization", () => {
    expect(normalizeTags("llm, LLMs, llm")).toBe("llm");
  });

  test("filters empty tags", () => {
    expect(normalizeTags("llm, , coding")).toBe("llm, coding");
  });

  test("handles single tag", () => {
    expect(normalizeTags("security")).toBe("security");
  });
});
