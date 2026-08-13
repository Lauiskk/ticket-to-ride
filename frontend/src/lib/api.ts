const BASE_URL = import.meta.env.VITE_API_URL || '/api';

/** Lê um cookie legível por JavaScript — hoje, só o par de CSRF. */
function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * URL absoluta, para links que o NAVEGADOR segue (OAuth e afins).
 *
 * O `fetch` se contenta com `/api` porque o dev server faz proxy. Um redirect
 * de página inteira, não: em produção `/api/auth/google` resolve contra o
 * domínio do site, o rewrite de SPA devolve `index.html`, e a pessoa cai numa
 * página em branco em vez do Google. Foi assim que o botão quebrou.
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
  /**
   * Token de CSRF em memória (B20). O cookie equivalente é do domínio da API, e
   * `document.cookie` de um domínio não enxerga cookie do outro — o navegador
   * manda, o JavaScript não lê. Por isso o valor vem no corpo da resposta.
   */
  private csrfToken: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /** Chamado pelo AuthContext sempre que a sessão é criada ou relida. */
  setCsrfToken(token: string | null | undefined): void {
    if (token) this.csrfToken = token;
  }

  clearCsrfToken(): void {
    this.csrfToken = null;
  }

  /**
   * A sessão não passa por aqui: vive num cookie `httpOnly` que o navegador
   * anexa sozinho. O que este método monta é a outra metade da dupla submissão,
   * o token de CSRF — legível de propósito, porque a defesa não está no segredo
   * dele, e sim em outra origem não conseguir lê-lo para copiar aqui.
   */
  private getHeaders(method: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (method !== 'GET' && method !== 'HEAD') {
      // Memória primeiro (funciona entre domínios); o cookie serve o dev
      const csrf = this.csrfToken ?? readCookie('csrf_token');
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }

    return headers;
  }

  /**
   * `allowAnonymous`: 401 é resposta legítima, não sessão perdida. Só `/auth/me`
   * usa. Sem isso, o visitante sem conta era expulso da vitrine pública para o
   * login (B19).
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

    if (res.status === 401) {
      const refreshed = await this.attemptRefresh();
      if (refreshed) {
        const retryRes = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: this.getHeaders(method),
          credentials: 'include',
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!retryRes.ok) throw await this.handleError(retryRes);
        return { data: await this.parseJson<T>(retryRes) };
      } else {
        this.clearSession();
        throw await this.handleError(res);
      }
    }

    if (!res.ok) throw await this.handleError(res);
    return { data: await this.parseJson<T>(res) };
  }

  /**
   * Diz algo útil quando a resposta não é JSON. `VITE_API_URL` ficou valendo
   * `teste` num deploy: toda chamada virou `/teste/...` no próprio domínio do
   * site, o rewrite de SPA respondeu `index.html` com HTTP 200, e o único
   * sintoma era "Unexpected token '<'".
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

  /** Renova a sessão. Chamadas concorrentes compartilham a mesma tentativa. */
  private async attemptRefresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;

    this.refreshing = (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: this.getHeaders('POST'),
          credentials: 'include',
        });
        if (!res.ok) return false;

        // Par de CSRF novo: sem isto, a primeira mutação levaria o token velho
        const data = await res.json().catch(() => null);
        this.setCsrfToken(data?.csrfToken);
        return true;
      } catch {
        return false;
      } finally {
        this.refreshing = null;
      }
    })();

    return this.refreshing;
  }

  private clearSession() {
    // Não há nada a apagar aqui: os cookies são do servidor. Só resta tirar a
    // pessoa de uma tela que ela não pode mais ver.
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
