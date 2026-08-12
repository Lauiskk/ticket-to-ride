import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isStoreBlocked, roleHome } from '../lib/roleHome';

/**
 * Wraps the buying surface — home, catalogue, event page (SPEC_CP11 RF-1).
 *
 * Stays public: a visitor who is not logged in must still be able to browse and
 * discover events. It only bounces roles that have no purchase path, so a gate
 * operator never lands on a page offering them a seat they cannot buy.
 */
export function StoreRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-board-cream">
        <div className="animate-pulse text-board-navy/50 font-display text-xl">Carregando...</div>
      </div>
    );
  }

  if (isStoreBlocked(user?.role)) {
    return <Navigate to={roleHome(user?.role)} replace />;
  }

  return <>{children}</>;
}
