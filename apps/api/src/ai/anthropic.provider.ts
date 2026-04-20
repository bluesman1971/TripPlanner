import Anthropic from '@anthropic-ai/sdk';
import type {
  AIProvider,
  PromptInput,
  CompletionOptions,
  CompletionOutput,
  StreamChunk,
} from '@trip-planner/shared';

export class AnthropicProvider implements AIProvider {
  private client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  async complete(prompt: PromptInput, opts: CompletionOptions = {}): Promise<CompletionOutput> {
    const response = await this.client.messages.create({
      model: opts.model ?? 'claude-sonnet-4-6',
      max_tokens: prompt.maxTokens ?? 4096,
      system: prompt.system,
      messages: prompt.messages,
      ...(opts.tools ? { tools: opts.tools as Anthropic.Tool[] } : {}),
    });

    const textBlock = response.content.find((b) => b.type === 'text');

    return {
      content: textBlock?.type === 'text' ? textBlock.text : '',
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  async *stream(prompt: PromptInput, opts: CompletionOptions = {}): AsyncIterable<StreamChunk> {
    const stream = this.client.messages.stream({
      model: opts.model ?? 'claude-sonnet-4-6',
      max_tokens: prompt.maxTokens ?? 8192,
      system: prompt.system,
      messages: prompt.messages,
      ...(opts.tools ? { tools: opts.tools as Anthropic.Tool[] } : {}),
    });

    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        yield { text: chunk.delta.text };
      }
    }
  }
}
