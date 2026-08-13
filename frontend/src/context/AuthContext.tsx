import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
    try {
      const res = await api.get<User & { csrfToken?: string }>('/auth/me', {
        allowAnonymous: true,
      });
      // O token de CSRF vem junto porque o cookie dele é de outro domínio (B20)
      api.setCsrfToken(res.data.csrfToken);
      setUser(res.data);
      return res.data;
    } catch {
      // 401 aqui é o caso comum: visitante sem sessão
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refreshSession().finally(() => setIsLoading(false));
  }, [refreshSession]);

  const login = async (email: string, password: string): Promise<User> => {
    const res = await api.post<AuthResponse>('/auth/login', { email, password });
    // O JWT veio no `Set-Cookie`; o token de CSRF vem no corpo (B20)
    api.setCsrfToken(res.data.csrfToken);
    setUser(res.data.user);
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
    setUser(res.data.user);
    return res.data.user;
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch { /* ignore */ }
    api.clearCsrfToken();
    setUser(null);
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
