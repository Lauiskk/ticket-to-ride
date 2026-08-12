import { Navigate } from 'react-router-dom';
import { useAuth, getDefaultRoute } from '../context/AuthContext';

interface GuestRouteProps {
  children: React.ReactNode;
}

/**
 * Wraps routes that should ONLY be accessible to unauthenticated users.
 * If already logged in → redirect to role-based dashboard.
 * Prevents logged-in users from accessing /login and /register.
 */
export function GuestRoute({ children }: GuestRouteProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-board-navy">
        <div className="animate-pulse text-board-parchment/50 font-display text-xl">Carregando...</div>
      </div>
    );
  }

  if (user) {
    return <Navigate to={getDefaultRoute(user.role)} replace />;
  }

  return <>{children}</>;
}
