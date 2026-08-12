import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { GuestRoute } from './components/GuestRoute';
import { ProtectedRoute } from './components/ProtectedRoute';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { EventsPage } from './pages/EventsPage';
import { EventDetailPage } from './pages/EventDetailPage';
import { PaymentPage } from './pages/PaymentPage';
import { MyTicketsPage } from './pages/MyTicketsPage';
import { OrganizerDashboard } from './pages/OrganizerDashboard';
import { GateValidationPage } from './pages/GateValidationPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/:id" element={<EventDetailPage />} />
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
