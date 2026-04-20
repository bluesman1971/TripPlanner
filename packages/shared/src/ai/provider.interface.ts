export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface Tool {
  type?: string;
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PromptInput {
  system: string;
  messages: Message[];
  maxTokens?: number;
}

export interface CompletionOptions {
  model?: string;
  temperature?: number;
  tools?: Tool[];
}

export interface CompletionOutput {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface StreamChunk {
  text: string;
}

export interface AIProvider {
  complete(prompt: PromptInput, options?: CompletionOptions): Promise<CompletionOutput>;
  stream(prompt: PromptInput, options?: CompletionOptions): AsyncIterable<StreamChunk>;
}
