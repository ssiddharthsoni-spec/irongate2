'use client';

import { useAuth } from '@clerk/nextjs';

export function useApiClient() {
  const { getToken } = useAuth();

  async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/v1';
    let token: string | null = null;
    try {
      token = await getToken();
    } catch {
      // Clerk not configured yet — fall through to dev token
    }

    return fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token || 'dev-token'}`,
        ...options?.headers,
      },
    });
  }

  return { apiFetch };
}
