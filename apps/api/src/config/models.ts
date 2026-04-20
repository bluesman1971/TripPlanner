export type CapabilityTier = 'fast' | 'balanced' | 'quality';

export const MODEL_CONFIG: Record<CapabilityTier, { provider: string; model: string }> = {
  fast:     { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  balanced: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  quality:  { provider: 'anthropic', model: 'claude-opus-4-6' },
};
