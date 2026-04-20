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
        'Content-Type': 'application/json',
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

  return { apiFetch, apiUpload };
}
