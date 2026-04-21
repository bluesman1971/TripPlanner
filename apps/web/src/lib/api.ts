/**
 * Typed fetch wrapper that attaches the Clerk JWT to every request.
 *
 * Usage:
 *   const { apiFetch } = useApi();
 *   const trips = await apiFetch<Trip[]>('/trips');
 *
 * Never call this outside a React component/hook — it needs useAuth().
 * For use in React Query: pass apiFetch into queryFn.
 */

import { useAuth } from '@clerk/react';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function useApi() {
  const { getToken } = useAuth();

  async function apiFetch<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const token = await getToken();

    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        message = body.error ?? message;
      } catch {
        // ignore parse errors
      }
      throw new ApiError(response.status, message);
    }

    // 204 No Content
    if (response.status === 204) return undefined as T;

    return response.json() as Promise<T>;
  }

  async function apiUpload<T>(
    path: string,
    formData: FormData,
  ): Promise<T> {
    const token = await getToken();

    const response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      body: formData,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        message = body.error ?? message;
      } catch {
        // ignore parse errors
      }
      throw new ApiError(response.status, message);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Initiates a streaming SSE fetch and calls onChunk for each text chunk.
   * Returns when the stream ends or rejects on error.
   */
  async function apiStream(
    path: string,
    onChunk: (text: string) => void,
    options: RequestInit = {},
  ): Promise<void> {
    const token = await getToken();

    const response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      ...options,
      headers: {
        // Only set Content-Type when there's a body — Fastify v5 rejects
        // 'application/json' with an empty body (FST_ERR_CTP_EMPTY_JSON_BODY)
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        message = body.error ?? message;
      } catch { /* ignore */ }
      throw new ApiError(response.status, message);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        try {
          const event = JSON.parse(payload) as { type: string; text?: string; message?: string };
          if (event.type === 'chunk' && event.text) {
            onChunk(event.text);
          } else if (event.type === 'error') {
            throw new Error(event.message ?? 'Streaming error');
          }
          // type === 'done' — loop exits naturally when stream closes
        } catch (e) {
          if (e instanceof Error && e.message !== payload) throw e;
        }
      }
    }
  }

  /**
   * Downloads a binary file from the API (requires Clerk JWT).
   * Triggers a browser download with the given filename.
   */
  async function apiDownload(path: string, filename: string): Promise<void> {
    const token = await getToken();

    const response = await fetch(`${API_URL}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        message = body.error ?? message;
      } catch { /* ignore */ }
      throw new ApiError(response.status, message);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return { apiFetch, apiUpload, apiStream, apiDownload };
}

/**
 * Fetch from the API without a Clerk JWT — for public endpoints like the client portal.
 * Call this at the module level or inside plain async functions (not inside useApi).
 */
export async function apiPublicFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`);

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = (body as { error?: string }).error ?? message;
    } catch { /* ignore */ }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
