import { describe, it, expect } from 'vitest';
import { estimateTokens, fitToTokenBudget, CONTEXT_BUDGETS } from './contextManager';

describe('contextManager', () => {

  describe('estimateTokens', () => {
    it('returns 0 for an empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('estimates 1 token for a 4-character string', () => {
      expect(estimateTokens('abcd')).toBe(1);
    });

    it('rounds up for strings that are not exact multiples of 4', () => {
      expect(estimateTokens('abc')).toBe(1);   // 3 chars → ceil(3/4) = 1
      expect(estimateTokens('abcde')).toBe(2); // 5 chars → ceil(5/4) = 2
    });

    it('scales linearly with length', () => {
      const text = 'a'.repeat(400);
      expect(estimateTokens(text)).toBe(100);
    });
  });

  describe('fitToTokenBudget', () => {
    it('returns the content unchanged when it fits within the budget', () => {
      const content = 'Short note.';
      const result = fitToTokenBudget(content, 1_000);
      expect(result.content).toBe(content);
      expect(result.truncated).toBe(false);
    });

    it('sets truncated=false when content is exactly at the budget boundary', () => {
      const content = 'a'.repeat(100); // 100 chars = 25 tokens
      const result = fitToTokenBudget(content, 25);
      expect(result.truncated).toBe(false);
    });

    it('truncates content when it exceeds the budget', () => {
      const content = 'a'.repeat(1_000); // 1000 chars = 250 tokens
      const result = fitToTokenBudget(content, 10); // budget: 10 tokens = 40 chars
      expect(result.truncated).toBe(true);
      // Leading 40 chars should be preserved
      expect(result.content.startsWith('a'.repeat(40))).toBe(true);
    });

    it('sets truncated=true when content exceeds the budget', () => {
      const result = fitToTokenBudget('a'.repeat(500), 50);
      expect(result.truncated).toBe(true);
    });

    it('appends a truncation notice when content is truncated', () => {
      const result = fitToTokenBudget('a'.repeat(500), 50);
      expect(result.content).toContain('truncated');
    });

    it('does not append a notice when content fits', () => {
      const result = fitToTokenBudget('short text', 1_000);
      expect(result.content).not.toContain('truncated');
    });

    it('returns empty string unchanged when budget is 0', () => {
      const result = fitToTokenBudget('', 0);
      expect(result.content).toBe('');
      expect(result.truncated).toBe(false);
    });
  });

  describe('CONTEXT_BUDGETS', () => {
    it('exports a draft.researchNotes budget', () => {
      expect(typeof CONTEXT_BUDGETS.draft.researchNotes).toBe('number');
      expect(CONTEXT_BUDGETS.draft.researchNotes).toBeGreaterThan(0);
    });

    it('exports a revision.currentItinerary budget', () => {
      expect(typeof CONTEXT_BUDGETS.revision.currentItinerary).toBe('number');
      expect(CONTEXT_BUDGETS.revision.currentItinerary).toBeGreaterThan(0);
    });
  });
});
