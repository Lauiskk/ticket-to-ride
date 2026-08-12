import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { motion } from 'framer-motion';
import { GiTicket, GiDiceSixFacesTwo, GiTheater } from 'react-icons/gi';

export function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className="sticky top-0 z-50 bg-board-navy/95 backdrop-blur-sm border-b border-board-gold/20 shadow-lg"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 group">
            <GiTicket className="text-board-gold text-2xl group-hover:rotate-12 transition-transform" />
            <span className="font-display text-xl font-bold text-board-parchment">
              Ticket to Ride
            </span>
          </Link>

          {/* Navigation links */}
          <div className="hidden md:flex items-center gap-6">
            <Link
              to="/events"
              className="text-board-parchment/80 hover:text-board-gold transition-colors font-medium flex items-center gap-1"
            >
              <GiTheater className="text-lg" />
              Eventos
            </Link>

            {user?.role === 'organizer' && (
              <Link
                to="/organizer"
                className="text-board-parchment/80 hover:text-board-gold transition-colors font-medium flex items-center gap-1"
              >
                <GiDiceSixFacesTwo className="text-lg" />
                Painel
              </Link>
            )}

            {user?.role === 'client' && (
              <Link
                to="/my-tickets"
                className="text-board-parchment/80 hover:text-board-gold transition-colors font-medium"
              >
                Meus Ingressos
              </Link>
            )}

            {user?.role === 'gate' && (
              <Link
                to="/gate"
                className="text-board-parchment/80 hover:text-board-gold transition-colors font-medium"
              >
                Portaria
              </Link>
            )}
          </div>

          {/* Auth */}
          <div className="flex items-center gap-3">
            {user ? (
              <div className="flex items-center gap-3">
                <span className="text-board-parchment/60 text-sm hidden sm:block">
                  {user.name}
                </span>
                <button onClick={handleLogout} className="btn-gold text-sm py-2 px-4">
                  Sair
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link to="/login" className="text-board-parchment hover:text-board-gold transition-colors font-medium text-sm">
                  Entrar
                </Link>
                <Link to="/register" className="btn-primary text-sm py-2 px-4">
                  Cadastrar
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.nav>
  );
}
