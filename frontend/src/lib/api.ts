const BASE_URL = import.meta.env.VITE_API_URL || '/api';

/** Lê um cookie legível por JavaScript — hoje, só o par de CSRF. */
function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

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

  /**
   * A sessão não passa mais por aqui (SPEC_CP20 RF-3).
   *
   * O token vivia no `localStorage` e ia como `Authorization: Bearer` — o que
   * significa que qualquer script rodando na página conseguia lê-lo e levá-lo
   * embora. Agora ele está num cookie `httpOnly` que o navegador anexa sozinho
   * (via `credentials: 'include'`) e que JavaScript nenhum consegue ler.
   *
   * O que este método monta é a outra metade: o token de CSRF, que é legível de
   * propósito. Ele não é segredo — a defesa está em um site de outra origem não
   * conseguir lê-lo para copiar aqui.
   */
  private getHeaders(method: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (method !== 'GET' && method !== 'HEAD') {
      const csrf = readCookie('csrf_token');
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }

    return headers;
  }

  /**
   * `options.allowAnonymous`: 401 é resposta legítima, não sessão perdida.
   *
   * Só `/auth/me` usa. Sem isso, um visitante abrindo a vitrine recebia 401 na
   * verificação de sessão, o cliente tentava renovar, falhava, e o "tratamento"
   * era mandá-lo para a tela de login — expulsando da loja pública justamente
   * quem ainda não tem conta.
   */
  async get<T = unknown>(
    path: string,
    options?: { allowAnonymous?: boolean },
  ): Promise<{ data: T }> {
    return this.request<T>('GET', path, undefined, options);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<{ data: T }> {
    return this.request<T>('POST', path, body);
  }

  async patch<T = unknown>(path: string, body?: unknown): Promise<{ data: T }> {
    return this.request<T>('PATCH', path, body);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { allowAnonymous?: boolean },
  ): Promise<{ data: T }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.getHeaders(method),
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && options?.allowAnonymous) {
      throw await this.handleError(res);
    }

    // Handle 401 — attempt token refresh
    if (res.status === 401) {
      const refreshed = await this.attemptRefresh();
      if (refreshed) {
        // Retry original request with new token
        const retryRes = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: this.getHeaders(method),
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
          headers: this.getHeaders('POST'),
          credentials: 'include',
        });
        // O cookie novo vem no `Set-Cookie` da resposta; não há nada para
        // guardar aqui — o sucesso é o próprio 200.
        return res.ok;
      } catch {
        return false;
      } finally {
        this.refreshing = null;
      }
    })();

    return this.refreshing;
  }

  private clearSession() {
    // Nada a apagar no navegador: os cookies são do servidor e ele os limpa no
    // logout. Aqui só resta tirar a pessoa de uma tela que ela não pode mais ver.
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
