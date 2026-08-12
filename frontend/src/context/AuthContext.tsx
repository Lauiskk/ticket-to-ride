import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../lib/api';
import type { AuthResponse } from '../types';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'organizer' | 'client' | 'gate';
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; name: string; role: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Try to restore session from stored token
    const stored = localStorage.getItem('ttr_user');
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch { /* ignore */ }
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.post<AuthResponse>('/auth/login', { email, password });
    const { user: userData, accessToken } = res.data;
    setUser(userData);
    localStorage.setItem('ttr_user', JSON.stringify(userData));
    localStorage.setItem('ttr_token', accessToken);
  };

  const register = async (data: { email: string; password: string; name: string; role: string }) => {
    const res = await api.post<AuthResponse>('/auth/register', data);
    const { user: userData, accessToken } = res.data;
    setUser(userData);
    localStorage.setItem('ttr_user', JSON.stringify(userData));
    localStorage.setItem('ttr_token', accessToken);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch { /* ignore */ }
    setUser(null);
    localStorage.removeItem('ttr_user');
    localStorage.removeItem('ttr_token');
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
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
