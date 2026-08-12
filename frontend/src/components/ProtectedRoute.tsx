import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

/**
 * Wraps routes that require authentication.
 * If not authenticated → redirect to /login.
 * If authenticated but wrong role → redirect to /events.
 */
export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-board-cream">
        <div className="animate-pulse text-board-navy/50 font-display text-xl">Carregando...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/events" replace />;
  }

  return <>{children}</>;
}
