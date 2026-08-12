import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { GuestRoute } from './components/GuestRoute';
import { ProtectedRoute } from './components/ProtectedRoute';
import { StoreRoute } from './components/StoreRoute';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { EventsPage } from './pages/EventsPage';
import { EventDetailPage } from './pages/EventDetailPage';
import { PaymentPage } from './pages/PaymentPage';
import { MyTicketsPage } from './pages/MyTicketsPage';
import { TicketDetailPage } from './pages/TicketDetailPage';
import { OrganizerDashboard } from './pages/OrganizerDashboard';
import { GateValidationPage } from './pages/GateValidationPage';

export function App() {
  return (
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
  );
}
