import type {
  AIProvider,
  PromptInput,
  CompletionOptions,
  CompletionOutput,
  StreamChunk,
} from '@trip-planner/shared';

export class OpenAIProvider implements AIProvider {
  async complete(_prompt: PromptInput, _opts?: CompletionOptions): Promise<CompletionOutput> {
    throw new Error('OpenAIProvider not implemented');
  }

  async *stream(_prompt: PromptInput, _opts?: CompletionOptions): AsyncIterable<StreamChunk> {
    throw new Error('OpenAIProvider not implemented');
  }
}
