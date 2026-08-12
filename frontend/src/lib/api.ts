const BASE_URL = import.meta.env.VITE_API_URL || '/api';

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
        const data = await retryRes.json();
        return { data };
      } else {
        // Refresh failed — clear session and redirect
        this.clearSession();
        throw await this.handleError(res);
      }
    }

    if (!res.ok) throw await this.handleError(res);
    const data = await res.json();
    return { data };
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
