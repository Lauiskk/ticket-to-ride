import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth, getDefaultRoute } from '../context/AuthContext';
import { CustomSelect } from '../components/CustomSelect';
import { PasswordStrength, usePasswordValidation } from '../components/PasswordStrength';
import { sanitizeInput, sanitizeEmail, validateLength } from '../lib/sanitize';
import { TrainLogo } from '../components/TrainLogo';

export function RegisterPage() {
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('client');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();
  const { isValid: isPasswordValid } = usePasswordValidation(password);

  const validateEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleEmailBlur = () => {
    if (email && !validateEmail(email)) {
      setEmailError('Formato de email inválido');
    } else {
      setEmailError('');
    }
  };

  /**
   * O nome só reclamava no envio, e num banner no topo do formulário — longe do
   * campo que precisa mudar. Agora avisa ao sair do campo, onde a pessoa ainda
   * está olhando (SPEC_CP18 RF-4).
   */
  const handleNameBlur = () => {
    const clean = sanitizeInput(name);
    setNameError(
      !name || validateLength(clean, 2, 100) ? '' : 'O nome deve ter entre 2 e 100 caracteres.',
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    // Sanitize inputs
    const cleanName = sanitizeInput(name);
    const cleanEmail = sanitizeEmail(email);

    // Validate lengths
    if (!validateLength(cleanName, 2, 100)) {
      setNameError('O nome deve ter entre 2 e 100 caracteres.');
      return;
    }
    if (!validateEmail(cleanEmail)) {
      setEmailError('Formato de email inválido');
      return;
    }
    if (!isPasswordValid) {
      setError('A senha não atende todos os requisitos');
      return;
    }
    setLoading(true);
    try {
      await register({ email: cleanEmail, password, name: cleanName, role });
      navigate(getDefaultRoute(role));
    } catch (err: any) {
      setError(err.message || 'Erro ao criar conta');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-board-navy flex items-center justify-center px-4 py-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2">
            <TrainLogo className="w-10 h-10" />
            <span className="font-display text-2xl font-bold text-board-parchment">Ticket to Ride</span>
          </Link>
        </div>

        <div className="bg-board-cream rounded-card shadow-card p-8">
          <h1 className="font-display text-2xl font-bold text-board-navy text-center mb-6">
            Criar conta
          </h1>

          {error && (
            <div className="bg-board-crimson/10 border border-board-crimson/30 text-board-crimson rounded-lg p-3 mb-4 text-sm text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="register-name" className="block text-sm font-medium text-board-navy/70 mb-1">
                Nome
              </label>
              <input
                id="register-name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError('');
                  setError('');
                }}
                onBlur={handleNameBlur}
                aria-invalid={nameError ? true : undefined}
                required
                className={`w-full px-4 py-3 rounded-lg border bg-white focus:outline-none focus:ring-2 transition-all ${
                  nameError
                    ? 'border-board-crimson focus:ring-board-crimson/30'
                    : 'border-board-parchment-dark focus:ring-board-gold/50 focus:border-board-gold'
                }`}
                placeholder="Seu nome"
              />
              {nameError && <p className="mt-1 text-xs text-board-crimson">{nameError}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-board-navy/70 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailError('');
                  setError('');
                }}
                onBlur={handleEmailBlur}
                aria-invalid={emailError ? true : undefined}
                required
                className={`w-full px-4 py-3 rounded-lg border bg-white focus:outline-none focus:ring-2 transition-all ${
                  emailError ? 'border-board-crimson focus:ring-board-crimson/30' : 'border-board-parchment-dark focus:ring-board-gold/50 focus:border-board-gold'
                }`}
                placeholder="seu@email.com"
              />
              {emailError && (
                <p className="mt-1 text-xs text-board-crimson">{emailError}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-board-navy/70 mb-1">Senha</label>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                required
                minLength={8}
                className="w-full px-4 py-3 rounded-lg border border-board-parchment-dark bg-white focus:outline-none focus:ring-2 focus:ring-board-gold/50 focus:border-board-gold transition-all"
                placeholder="Mínimo 8 caracteres"
              />
              <PasswordStrength password={password} />
            </div>

            <div>
              <label className="block text-sm font-medium text-board-navy/70 mb-1">Eu sou...</label>
              <CustomSelect
                options={[
                  { value: 'client', label: 'Quero comprar ingressos', icon: '🎫' },
                  { value: 'organizer', label: 'Quero organizar eventos', icon: '🎪' },
                ]}
                value={role}
                onChange={setRole}
                placeholder="Selecione seu perfil"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Criando...' : 'Criar Conta'}
            </button>
          </form>

          <p className="text-center text-sm text-board-navy/60 mt-6">
            Já tem conta?{' '}
            <Link to="/login" className="text-board-crimson font-medium hover:underline">
              Entrar
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
