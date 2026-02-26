'use client';

import { useAuth } from '@clerk/nextjs';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://irongate-api.onrender.com/v1';

export function useApiClient() {
  const { getToken } = useAuth();

  async function resolveToken(): Promise<string> {
    try {
      const token = await getToken();
      if (!token) {
        throw new Error('Session expired. Please sign in again.');
      }
      return token;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Session expired')) throw err;
      throw new Error('Authentication failed. Please sign in again.');
    }
  }

  async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
    const token = await resolveToken();

    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: options?.signal || AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options?.headers,
      },
    });

    if (response.status === 401) {
      throw new Error('Session expired. Please sign in again.');
    }

    return response;
  }

  /**
   * Fetch without Content-Type header — used for multipart/form-data uploads
   * where the browser must set the boundary automatically.
   */
  async function apiFetchRaw(path: string, options?: RequestInit): Promise<Response> {
    const token = await resolveToken();

    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: options?.signal || AbortSignal.timeout(30000),
      headers: {
        'Authorization': `Bearer ${token}`,
        ...options?.headers,
      },
    });

    if (response.status === 401) {
      throw new Error('Session expired. Please sign in again.');
    }

    return response;
  }

  return { apiFetch, apiFetchRaw };
}
