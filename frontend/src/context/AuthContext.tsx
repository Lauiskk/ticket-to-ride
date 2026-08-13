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
  /** Relê a sessão no servidor. O retorno do Google depende disto. */
  refreshSession: () => Promise<User | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

/** Piso entre reconferências: alternar de aba não pode virar rajada. */
const SESSION_RECHECK_INTERVAL_MS = 15_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /** Quem esta aba acredita ser, para detectar a troca por baixo dela. */
  const knownUserId = useRef<string | null>(null);

  /**
   * Impede a resposta atrasada de passar na frente da recente: um `/auth/me`
   * disparado antes do cookie existir volta 401 depois do login e desfaria o
   * login que acabou de dar certo.
   */
  const sessionEpoch = useRef(0);

  /**
   * Adota a identidade que o servidor informou. Se ela mudou, o cache inteiro
   * vai embora: ele responde "quais são os MEUS ingressos", pergunta cuja
   * resposta depende de quem perguntou.
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
   * Quem está logado, segundo o servidor. A sessão mora num cookie `httpOnly`,
   * que o JavaScript não lê nem para saber de quem é — então pergunta. O papel
   * que monta a interface passa a vir de um JWT verificado, não de um JSON que
   * qualquer um podia editar para virar "organizer" na própria tela.
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
   * A aba reconfere quem ela é ao voltar para a frente.
   *
   * A sessão é um cookie do navegador inteiro; o usuário é estado React de uma
   * aba. Entrar com outra conta em outra aba troca o cookie das duas, e esta
   * seguia estampando o nome antigo enquanto já pedia como a conta nova — foi
   * assim que uma tela de cliente ficou exibindo "nenhum ingresso".
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
    // encontrar os ingressos de quem saiu
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

/** Para onde cada papel vai depois de entrar. */
export function getDefaultRoute(role: string): string {
  switch (role) {
    case 'organizer': return '/organizer';
    case 'gate': return '/gate';
    case 'client':
    default: return '/events';
  }
}
