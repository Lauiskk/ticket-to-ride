import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { AuthResponse } from '../types';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'organizer' | 'client' | 'gate';
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: {
    email: string;
    password: string;
    name: string;
    role: string;
  }) => Promise<User>;
  /**
   * Relê a sessão do servidor e devolve quem é. Usado pelo retorno do Google,
   * que cria a sessão fora do formulário — o SPA só sabe que ela existe
   * perguntando.
   */
  refreshSession: () => Promise<User | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

/**
 * Piso entre duas reconferências de sessão (SPEC_CP24 RF-6).
 *
 * Alternar de aba é gesto barato e repetido; sem piso, uma pessoa passando por
 * três abas dispara três `/auth/me` em um segundo — e o limitador do CP21 está
 * ali justamente para não deixar isso escalar.
 */
const SESSION_RECHECK_INTERVAL_MS = 15_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /** Quem esta aba acredita ser, para detectar a troca por baixo dela. */
  const knownUserId = useRef<string | null>(null);

  /**
   * Contador de decisões de sessão, para a resposta atrasada não passar na
   * frente da recente.
   *
   * A reconferência por foco criou uma corrida que não existia: ela dispara um
   * `/auth/me` que pode estar voando quando a pessoa entra pelo formulário. Se
   * essa consulta saiu **antes** do cookie existir, ela volta 401 **depois** do
   * login — e desfaz o login que acabou de dar certo. Seria o B18 de novo, agora
   * por outro caminho: entrar e a tela não reagir.
   */
  const sessionEpoch = useRef(0);

  /**
   * Adota a identidade que o servidor acabou de informar (SPEC_CP24 RF-5).
   *
   * Se ela mudou, o cache de consultas inteiro vai embora. Ele foi preenchido
   * respondendo "quais são os *meus* ingressos", "quais são os *meus* eventos" —
   * perguntas cuja resposta depende de quem perguntou. Mantê-lo depois da troca
   * é exibir dado de uma conta na tela de outra.
   */
  const applySession = useCallback(
    (next: User | null) => {
      sessionEpoch.current += 1;

      const nextId = next?.id ?? null;
      if (knownUserId.current !== nextId) {
        queryClient.clear();
        knownUserId.current = nextId;
      }
      setUser(next);
    },
    [queryClient],
  );

  /**
   * Quem está logado, segundo o servidor (SPEC_CP20 RF-3).
   *
   * A sessão mora num cookie `httpOnly`: o JavaScript não consegue lê-la nem
   * para saber de quem é. Então o SPA pergunta. Além de necessário, é mais
   * honesto do que antes — o papel que monta a interface passa a vir de um JWT
   * verificado no servidor, e não de um JSON no `localStorage` que qualquer um
   * podia editar para virar "organizer" na própria tela.
   */
  const refreshSession = useCallback(async (): Promise<User | null> => {
    const epoch = sessionEpoch.current;
    /** Outra decisão de sessão aconteceu enquanto esta consulta voltava. */
    const superada = () => epoch !== sessionEpoch.current;

    try {
      const res = await api.get<User & { csrfToken?: string }>('/auth/me', {
        allowAnonymous: true,
      });
      if (superada()) return res.data;
      // O token de CSRF vem junto porque o cookie dele é de outro domínio (B20)
      api.setCsrfToken(res.data.csrfToken);
      applySession(res.data);
      return res.data;
    } catch {
      // 401 aqui é o caso comum: visitante sem sessão
      if (!superada()) applySession(null);
      return null;
    }
  }, [applySession]);

  useEffect(() => {
    refreshSession().finally(() => setIsLoading(false));
  }, [refreshSession]);

  /**
   * A aba reconfere quem ela é ao voltar para a frente (SPEC_CP24 RF-4).
   *
   * A sessão é um cookie do **navegador inteiro**; o usuário é estado React de
   * **uma aba**. Quem entra com outra conta em outra aba troca o cookie das
   * duas, e esta continua estampando o nome antigo enquanto já faz cada
   * requisição como a conta nova — foi assim que uma tela de cliente ficou
   * exibindo "nenhum ingresso": o servidor estava respondendo certo, para a
   * portaria. Voltar para a aba é justamente o instante em que a resposta pode
   * ter mudado, então é o instante de perguntar de novo.
   */
  useEffect(() => {
    let lastCheck = Date.now();

    const recheck = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastCheck < SESSION_RECHECK_INTERVAL_MS) return;
      lastCheck = Date.now();
      void refreshSession();
    };

    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [refreshSession]);

  const login = async (email: string, password: string): Promise<User> => {
    const res = await api.post<AuthResponse>('/auth/login', { email, password });
    // O JWT veio no `Set-Cookie`; o token de CSRF vem no corpo (B20)
    api.setCsrfToken(res.data.csrfToken);
    applySession(res.data.user);
    return res.data.user;
  };

  const register = async (data: {
    email: string;
    password: string;
    name: string;
    role: string;
  }): Promise<User> => {
    const res = await api.post<AuthResponse>('/auth/register', data);
    api.setCsrfToken(res.data.csrfToken);
    applySession(res.data.user);
    return res.data.user;
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch { /* ignore */ }
    api.clearCsrfToken();
    // Sai a sessão, sai o cache: o próximo a entrar neste computador não pode
    // encontrar os ingressos de quem saiu (SPEC_CP24 RF-5)
    applySession(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, refreshSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}

/**
 * Returns the default route for a given user role.
 * Used for post-login/register redirect and guest route protection.
 */
export function getDefaultRoute(role: string): string {
  switch (role) {
    case 'organizer': return '/organizer';
    case 'gate': return '/gate';
    case 'client':
    default: return '/events';
  }
}
