'use client';

import { useAuth } from '@clerk/nextjs';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://irongate-api.onrender.com/v1';

export function useApiClient() {
  const { getToken } = useAuth();

  async function resolveToken(): Promise<string> {
    try {
      const token = await getToken();
      return token || '';
    } catch {
      return '';
    }
  }

  async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
    const token = await resolveToken();

    return fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options?.headers,
      },
    });
  }

  /**
   * Fetch without Content-Type header — used for multipart/form-data uploads
   * where the browser must set the boundary automatically.
   */
  async function apiFetchRaw(path: string, options?: RequestInit): Promise<Response> {
    const token = await resolveToken();

    return fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options?.headers,
      },
    });
  }

  return { apiFetch, apiFetchRaw };
}
