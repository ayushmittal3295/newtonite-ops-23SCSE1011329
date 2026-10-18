export const API_BASE = '/api';

export function getToken() {
  return localStorage.getItem('newtonite_token');
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers ?? {});
  headers.set('Content-Type', 'application/json');

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401 && token) {
    localStorage.removeItem('newtonite_token');
    if (window.location.pathname !== '/login' && window.location.pathname !== '/setup') {
      window.location.assign('/login');
    }
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error((payload as { error?: string }).error ?? 'Request failed');
  }

  return (await response.json()) as T;
}
