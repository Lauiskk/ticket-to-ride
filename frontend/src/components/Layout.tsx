import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-board-cream">
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="bg-board-navy text-board-parchment py-8 text-center font-body text-sm border-t-0">
        <p>&copy; 2026 Ticket to Ride. Todos os direitos reservados.</p>
      </footer>
    </div>
  );
}
