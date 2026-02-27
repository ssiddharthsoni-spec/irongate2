'use client';

import { useAuth } from '@clerk/nextjs';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://irongate-api.onrender.com/v1';

export function useApiClient() {
  const { getToken } = useAuth();

  async function resolveToken(): Promise<string> {
    // In local dev, the API accepts unauthenticated requests (IRON_GATE_DEV_AUTH)
    const isDev = typeof window !== 'undefined' && window.location.hostname === 'localhost';
    try {
      // Race getToken against a 3s timeout so a missing Clerk session doesn't hang forever
      const token = await Promise.race([
        getToken(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      if (!token) {
        if (isDev) return '';
        throw new Error('Session expired. Please sign in again.');
      }
      return token;
    } catch (err) {
      if (isDev) return '';
      if (err instanceof Error && err.message.includes('Session expired')) throw err;
      throw new Error('Authentication failed. Please sign in again.', { cause: err });
    }
  }

  async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
    const token = await resolveToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers as Record<string, string>,
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: options?.signal || AbortSignal.timeout(15000),
      headers,
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

    const headers: Record<string, string> = {
      ...options?.headers as Record<string, string>,
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: options?.signal || AbortSignal.timeout(30000),
      headers,
    });

    if (response.status === 401) {
      throw new Error('Session expired. Please sign in again.');
    }

    return response;
  }

  return { apiFetch, apiFetchRaw };
}
