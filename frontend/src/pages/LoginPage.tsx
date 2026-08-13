import { useState, useEffect, FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth, getDefaultRoute } from '../context/AuthContext';
import { sanitizeEmail } from '../lib/sanitize';
import { apiUrl } from '../lib/api';
import { TrainLogo } from '../components/TrainLogo';

/** O bastante para pegar erro de digitação, sem tentar adivinhar o que é um e-mail. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// O parser do `user` que vinha na URL saiu junto com o token: nada de sessão
// trafega mais por query string (SPEC_CP20 RF-4).

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, refreshSession } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  /**
   * Volta do Google (SPEC_CP20 RF-4).
   *
   * A URL não traz mais token nem dados do usuário — só o aviso de que a
   * sessão foi criada. Ela está no cookie `httpOnly`, que este código não
   * consegue ler: quem conta quem entrou é o servidor, no `/auth/me`.
   */
  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) {
      setError(errorParam);
      return;
    }

    if (searchParams.get('oauth') !== 'ok') return;

    let cancelled = false;

    (async () => {
      const loggedIn = await refreshSession();
      if (cancelled) return;

      window.history.replaceState({}, '', '/login');

      if (loggedIn) {
        navigate(getDefaultRoute(loggedIn.role), { replace: true });
      } else {
        setError('Não foi possível concluir o login com o Google. Tente novamente.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, navigate, refreshSession]);

  /**
   * Checagem ao sair do campo (SPEC_CP18 RF-4). Antes, um e-mail digitado
   * errado só era descoberto depois da ida ao servidor, e voltava como
   * "credenciais inválidas" — mandando a pessoa desconfiar da senha.
   */
  const checkEmail = () => {
    setEmailError(!email || EMAIL_SHAPE.test(email) ? '' : 'Formato de e-mail inválido.');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_SHAPE.test(email)) {
      setEmailError('Formato de e-mail inválido.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      // O papel vem da resposta do servidor, não de um JSON no navegador
      const userData = await login(sanitizeEmail(email), password);
      navigate(getDefaultRoute(userData.role));
    } catch (err: any) {
      setError(err.message || 'Credenciais inválidas');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-board-navy flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2">
            <TrainLogo className="w-10 h-10" />
            <span className="font-display text-2xl font-bold text-board-parchment">
              Ticket to Ride
            </span>
          </Link>
        </div>

        {/* Form card */}
        <div className="bg-board-cream rounded-card shadow-card p-8">
          <h1 className="font-display text-2xl font-bold text-board-navy text-center mb-6">
            Entrar na conta
          </h1>

          {error && (
            <div className="bg-board-crimson/10 border border-board-crimson/30 text-board-crimson rounded-lg p-3 mb-4 text-sm text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-board-navy/70 mb-1">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                // O erro descreve o que estava no campo, não o que está sendo
                // digitado agora — some ao primeiro toque (SPEC_CP18 RF-5)
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailError('');
                  setError('');
                }}
                onBlur={checkEmail}
                aria-invalid={emailError ? true : undefined}
                required
                className={`w-full px-4 py-3 rounded-lg border bg-white
                         focus:outline-none focus:ring-2 transition-all ${
                           emailError
                             ? 'border-board-crimson focus:ring-board-crimson/30'
                             : 'border-board-parchment-dark focus:ring-board-gold/50 focus:border-board-gold'
                         }`}
                placeholder="seu@email.com"
              />
              {emailError && <p className="mt-1 text-xs text-board-crimson">{emailError}</p>}
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-board-navy/70 mb-1">
                Senha
              </label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                required
                className="w-full px-4 py-3 rounded-lg border border-board-parchment-dark bg-white
                         focus:outline-none focus:ring-2 focus:ring-board-gold/50 focus:border-board-gold
                         transition-all"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <p className="text-center text-sm text-board-navy/60 mt-6">
            Não tem conta?{' '}
            <Link to="/register" className="text-board-crimson font-medium hover:underline">
              Cadastre-se
            </Link>
          </p>

          {/* Google OAuth */}
          <div className="mt-4">
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-board-parchment-dark" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-board-cream px-2 text-board-navy/40">ou continue com</span>
              </div>
            </div>
            <a
              href={apiUrl('/auth/google')}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-board-parchment-dark bg-white hover:bg-board-parchment/30 transition-colors font-medium text-board-navy"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Google
            </a>
          </div>

          {/* Quick login hint for dev */}
          <div className="mt-4 p-3 bg-board-parchment rounded-lg text-xs text-board-navy/50 space-y-1">
            <p className="font-medium text-board-navy/70">Contas de teste:</p>
            <p>organizer@ticket.dev / Organizer123!</p>
            <p>client1@ticket.dev / Client123!</p>
            <p>gate@ticket.dev / Gate123!</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
