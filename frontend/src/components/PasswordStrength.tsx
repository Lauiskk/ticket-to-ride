import { useMemo } from 'react';
import { motion } from 'framer-motion';

interface PasswordStrengthProps {
  password: string;
}

interface Requirement {
  label: string;
  met: boolean;
}

export function usePasswordValidation(password: string) {
  const requirements: Requirement[] = useMemo(() => [
    { label: 'Mínimo 8 caracteres', met: password.length >= 8 },
    { label: 'Letra maiúscula', met: /[A-Z]/.test(password) },
    { label: 'Letra minúscula', met: /[a-z]/.test(password) },
    { label: 'Número', met: /[0-9]/.test(password) },
    { label: 'Caractere especial (!@#$%^&*)', met: /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password) },
  ], [password]);

  const strength = requirements.filter((r) => r.met).length;
  const isValid = strength === requirements.length;

  return { requirements, strength, isValid };
}

export function PasswordStrength({ password }: PasswordStrengthProps) {
  const { requirements, strength } = usePasswordValidation(password);

  if (!password) return null;

  const getStrengthColor = () => {
    if (strength <= 1) return 'bg-red-500';
    if (strength <= 2) return 'bg-orange-500';
    if (strength <= 3) return 'bg-yellow-500';
    if (strength <= 4) return 'bg-lime-500';
    return 'bg-emerald-500';
  };

  const getStrengthLabel = () => {
    if (strength <= 1) return 'Muito fraca';
    if (strength <= 2) return 'Fraca';
    if (strength <= 3) return 'Média';
    if (strength <= 4) return 'Forte';
    return 'Muito forte';
  };

  return (
    <div className="mt-2 space-y-2">
      {/* Strength bar */}
      <div className="flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: i < strength ? 1 : 0.3 }}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-300 origin-left ${
              i < strength ? getStrengthColor() : 'bg-board-parchment-dark'
            }`}
          />
        ))}
      </div>

      {/* Strength label */}
      <p className={`text-xs font-medium ${
        strength <= 2 ? 'text-red-600' : strength <= 3 ? 'text-yellow-600' : 'text-emerald-600'
      }`}>
        {getStrengthLabel()}
      </p>

      {/* Requirements checklist */}
      <ul className="space-y-1">
        {requirements.map((req) => (
          <li key={req.label} className="flex items-center gap-2 text-xs">
            <span className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${
              req.met ? 'bg-emerald-100 text-emerald-600' : 'bg-board-parchment-dark/50 text-board-navy/30'
            }`}>
              {req.met ? (
                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
              )}
            </span>
            <span className={req.met ? 'text-emerald-700' : 'text-board-navy/50'}>
              {req.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
