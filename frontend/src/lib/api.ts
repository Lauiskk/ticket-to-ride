const BASE_URL = import.meta.env.VITE_API_URL || '/api';

/**
 * Absolute URL for an API path, for links the BROWSER navigates to.
 *
 * `fetch` is happy with the relative `/api` default because the dev server
 * proxies it. A full-page redirect is not: in production `/api/auth/google`
 * resolves against the frontend's own domain, the SPA rewrite answers with
 * `index.html`, and the user lands on a blank page instead of Google. That is
 * exactly how the OAuth button broke.
 *
 * Use this for OAuth entry points and any other `href` that leaves the SPA.
 */
export function apiUrl(path: string): string {
  const base = BASE_URL.startsWith('http')
    ? BASE_URL
    : `${window.location.origin}${BASE_URL}`;

  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

class ApiClient {
  private baseUrl: string;
  private refreshing: Promise<boolean> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = localStorage.getItem('ttr_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async get<T = unknown>(path: string): Promise<{ data: T }> {
    return this.request<T>('GET', path);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<{ data: T }> {
    return this.request<T>('POST', path, body);
  }

  async patch<T = unknown>(path: string, body?: unknown): Promise<{ data: T }> {
    return this.request<T>('PATCH', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<{ data: T }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.getHeaders(),
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });

    // Handle 401 — attempt token refresh
    if (res.status === 401) {
      const refreshed = await this.attemptRefresh();
      if (refreshed) {
        // Retry original request with new token
        const retryRes = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: this.getHeaders(),
          credentials: 'include',
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!retryRes.ok) throw await this.handleError(retryRes);
        return { data: await this.parseJson<T>(retryRes) };
      } else {
        // Refresh failed — clear session and redirect
        this.clearSession();
        throw await this.handleError(res);
      }
    }

    if (!res.ok) throw await this.handleError(res);
    return { data: await this.parseJson<T>(res) };
  }

  /**
   * Parse a JSON response, and say something useful when it isn't JSON.
   *
   * This caught a real production outage: `VITE_API_URL` was set to `teste`, so
   * every call resolved to `/teste/...` on the frontend's own domain. The SPA
   * rewrite answered with `index.html` — HTTP 200, `text/html` — and the only
   * symptom the user saw was "Unexpected token '<'". An API base URL pointing
   * at the app itself is a configuration mistake, and the error should say so.
   */
  private async parseJson<T>(res: Response): Promise<T> {
    const contentType = res.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      const sameOrigin = new URL(res.url, window.location.href).origin === window.location.origin;

      throw {
        status: res.status,
        code: 'INVALID_API_RESPONSE',
        message: sameOrigin
          ? `A API respondeu HTML em vez de JSON (${res.url}). Confira VITE_API_URL — ela parece apontar para o próprio site.`
          : `A API respondeu em formato inesperado (${contentType || 'sem content-type'}).`,
      };
    }

    return res.json() as Promise<T>;
  }

  /**
   * Attempt token refresh. Deduplicates concurrent refresh calls.
   */
  private async attemptRefresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;

    this.refreshing = (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: this.getHeaders(),
          credentials: 'include',
        });
        if (!res.ok) return false;
        const data = await res.json();
        if (data.accessToken) {
          localStorage.setItem('ttr_token', data.accessToken);
          if (data.user) localStorage.setItem('ttr_user', JSON.stringify(data.user));
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        this.refreshing = null;
      }
    })();

    return this.refreshing;
  }

  private clearSession() {
    localStorage.removeItem('ttr_user');
    localStorage.removeItem('ttr_token');
    // Redirect to login if not already there
    if (!window.location.pathname.includes('/login')) {
      window.location.href = '/login';
    }
  }

  private async handleError(res: Response) {
    try {
      const body = await res.json();
      return { status: res.status, ...body };
    } catch {
      return { status: res.status, message: 'Erro de conexão com o servidor', code: 'NETWORK_ERROR' };
    }
  }
}

export const api = new ApiClient(BASE_URL);
