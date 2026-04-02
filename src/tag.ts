const SYNONYMS = new Map<string, string>([
  ["llms", "llm"],
  ["large-language-models", "llm"],
  ["large-language-model", "llm"],
  ["ai-agents", "agents"],
  ["agent", "agents"],
  ["ai-agent", "agents"],
  ["ml", "machine-learning"],
  ["sec", "security"],
  ["dev", "coding"],
  ["development", "coding"],
  ["programming", "coding"],
  ["devtools", "tools"],
  ["developer-tools", "tools"],
  ["retrieval-augmented-generation", "rag"],
  ["local-llm", "local-models"],
  ["local-llms", "local-models"],
  ["model-context-protocol", "mcp"],
]);

export function normalizeTag(tag: string): string {
  const cleaned = tag.trim().toLowerCase().replace(/\s+/g, "-");
  return SYNONYMS.get(cleaned) ?? cleaned;
}

export function normalizeTags(tagsStr: string): string {
  const tags = tagsStr
    .split(",")
    .map(normalizeTag)
    .filter((t) => t.length > 0);
  // deduplicate while preserving order
  return [...new Set(tags)].join(", ");
}
