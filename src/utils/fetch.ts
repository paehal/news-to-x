import { fetch as undiciFetch, RequestInit, Response } from 'undici';

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * AbortController 付き fetch ラッパー。
 */
export const fetchWithTimeout = async (url: string, options: FetchOptions = {}): Promise<Response> => {
  const { timeoutMs = 20000, ...rest } = options;
  if (rest.signal) {
    return undiciFetch(url, rest);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await undiciFetch(url, {
      ...rest,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
};
