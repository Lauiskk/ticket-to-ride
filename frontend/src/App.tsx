import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { GuestRoute } from './components/GuestRoute';
import { ProtectedRoute } from './components/ProtectedRoute';
import { StoreRoute } from './components/StoreRoute';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { EventsPage } from './pages/EventsPage';

/**
 * Split by route.
 *
 * Everything used to ship in one bundle, so a visitor browsing events also
 * downloaded the QR scanner (html5-qrcode, 3 MB of source) and Stripe.js — code
 * for two roles they will never have. Home, login and the catalogue stay eager
 * because they are the first thing almost everyone sees.
 */
const EventDetailPage = lazy(() =>
  import('./pages/EventDetailPage').then((m) => ({ default: m.EventDetailPage })),
);
const PaymentPage = lazy(() =>
  import('./pages/PaymentPage').then((m) => ({ default: m.PaymentPage })),
);
const MyTicketsPage = lazy(() =>
  import('./pages/MyTicketsPage').then((m) => ({ default: m.MyTicketsPage })),
);
const TicketDetailPage = lazy(() =>
  import('./pages/TicketDetailPage').then((m) => ({ default: m.TicketDetailPage })),
);
const OrganizerDashboard = lazy(() =>
  import('./pages/OrganizerDashboard').then((m) => ({ default: m.OrganizerDashboard })),
);
const GateValidationPage = lazy(() =>
  import('./pages/GateValidationPage').then((m) => ({ default: m.GateValidationPage })),
);

/** Neutral placeholder while a route chunk arrives. */
function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-board-cream">
      <div className="w-8 h-8 rounded-full border-2 border-board-gold/30 border-t-board-gold animate-spin" />
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route element={<Layout />}>
        {/* Buying surface — public, but closed to roles with no purchase path */}
        <Route
          index
          element={
            <StoreRoute>
              <HomePage />
            </StoreRoute>
          }
        />
        <Route
          path="events"
          element={
            <StoreRoute>
              <EventsPage />
            </StoreRoute>
          }
        />
        <Route
          path="events/:id"
          element={
            <StoreRoute>
              <EventDetailPage />
            </StoreRoute>
          }
        />
        <Route
          path="payment/:reservationId"
          element={
            <ProtectedRoute allowedRoles={['client']}>
              <PaymentPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="my-tickets"
          element={
            <ProtectedRoute allowedRoles={['client']}>
              <MyTicketsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="my-tickets/:ticketId"
          element={
            <ProtectedRoute allowedRoles={['client']}>
              <TicketDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="organizer"
          element={
            <ProtectedRoute allowedRoles={['organizer']}>
              <OrganizerDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="gate"
          element={
            <ProtectedRoute allowedRoles={['gate']}>
              <GateValidationPage />
            </ProtectedRoute>
          }
        />
      </Route>
      <Route
        path="login"
        element={
          <GuestRoute>
            <LoginPage />
          </GuestRoute>
        }
      />
      <Route
        path="register"
        element={
          <GuestRoute>
            <RegisterPage />
          </GuestRoute>
        }
      />
    </Routes>
    </Suspense>
  );
}
