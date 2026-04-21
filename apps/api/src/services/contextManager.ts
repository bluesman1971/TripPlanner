// Rough heuristic: 1 token ≈ 4 UTF-8 characters (standard estimate for English prose).
// Used only for pre-flight budget checks — not for billing or exact limits.
const CHARS_PER_TOKEN = 4;

// Per-phase input context budgets (in tokens).
// These cap the content passed INTO the prompt, not the AI's output (maxTokens).
// Keeping inputs within budget prevents silent context-overflow failures on long trips.
export const CONTEXT_BUDGETS = {
  draft: {
    researchNotes: 8_000,      // research notes passed to the draft prompt
  },
  revision: {
    currentItinerary: 10_000,  // itinerary markdown passed to the revision prompt
  },
} as const;

/** Estimates the token count for a string using the 4-chars-per-token heuristic. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Truncates `content` so it fits within `maxTokens`.
 * If truncation is required, appends a notice so the AI knows the context is partial.
 * Returns the (possibly truncated) content and whether truncation occurred.
 */
export function fitToTokenBudget(
  content: string,
  maxTokens: number,
): { content: string; truncated: boolean } {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (content.length <= maxChars) {
    return { content, truncated: false };
  }
  const trimmed = content.slice(0, maxChars);
  return {
    content: trimmed + '\n\n[Note: earlier content was truncated to fit the context budget.]',
    truncated: true,
  };
}
