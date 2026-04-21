import Anthropic from '@anthropic-ai/sdk';
import type {
  AIProvider,
  PromptInput,
  CompletionOptions,
  CompletionOutput,
  StreamChunk,
} from '@trip-planner/shared';

export interface StreamUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

// Minimal interface for the Anthropic SDK's message stream object.
// The SDK's concrete type is not exported under a stable path so we declare
// what we actually need rather than importing an internal type.
interface AnthropicMessageStream extends AsyncIterable<Anthropic.MessageStreamEvent> {
  finalMessage(): Promise<Anthropic.Message>;
}

/**
 * Wraps an Anthropic message stream so it can be iterated (yielding StreamChunks)
 * and also provides token usage after the stream ends via getUsage().
 */
export class StreamHandle implements AsyncIterable<StreamChunk> {
  constructor(private readonly _msgStream: AnthropicMessageStream) {}

  async *[Symbol.asyncIterator](): AsyncGenerator<StreamChunk> {
    for await (const event of this._msgStream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield { text: event.delta.text };
      }
    }
  }

  /** Returns usage data. Must be called AFTER iterating the stream to completion. */
  async getUsage(): Promise<StreamUsage> {
    const msg = await this._msgStream.finalMessage();
    return {
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
      model: msg.model,
    };
  }
}

export class AnthropicProvider implements AIProvider {
  private client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  async complete(prompt: PromptInput, opts: CompletionOptions = {}): Promise<CompletionOutput> {
    const response = await this.client.messages.create({
      model: opts.model ?? 'claude-sonnet-4-6',
      max_tokens: prompt.maxTokens ?? 4096,
      system: prompt.system,
      messages: prompt.messages,
      ...(opts.tools ? { tools: opts.tools as unknown as Anthropic.Tool[] } : {}),
    });

    const textBlock = response.content.find((b) => b.type === 'text');

    return {
      content: textBlock?.type === 'text' ? textBlock.text : '',
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  /** Satisfies the AIProvider interface. Prefer streamWithUsage() in route handlers. */
  async *stream(prompt: PromptInput, opts: CompletionOptions = {}): AsyncIterable<StreamChunk> {
    const handle = this.streamWithUsage(prompt, opts);
    for await (const chunk of handle) {
      yield chunk;
    }
  }

  /**
   * Like stream() but the returned handle also exposes getUsage() for token logging.
   * Call getUsage() after iterating the handle to completion.
   */
  streamWithUsage(prompt: PromptInput, opts: CompletionOptions = {}): StreamHandle {
    const msgStream = this.client.messages.stream({
      model: opts.model ?? 'claude-sonnet-4-6',
      max_tokens: prompt.maxTokens ?? 8192,
      system: prompt.system,
      messages: prompt.messages,
      ...(opts.tools ? { tools: opts.tools as unknown as Anthropic.Tool[] } : {}),
    }) as unknown as AnthropicMessageStream;

    return new StreamHandle(msgStream);
  }
}
