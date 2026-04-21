import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@clerk/react';
import { AppShell } from './components/layout/AppShell';
import { SignInPage } from './pages/SignInPage';
import { DashboardPage } from './pages/DashboardPage';
import { ClientsPage } from './pages/ClientsPage';
import { NewTripPage } from './pages/NewTripPage';
import { TripPage } from './pages/TripPage';
import { LoadingSpinner } from './components/ui/LoadingSpinner';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

/** Wraps routes that require authentication. */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) return <LoadingSpinner message="Checking auth…" />;
  if (!isSignedIn) return <Navigate to="/sign-in" replace />;

  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/sign-in/*" element={<SignInPage />} />

      {/* Protected — all inside the app shell */}
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
        <Route path="trips/:id" element={<ErrorBoundary><TripPage /></ErrorBoundary>} />
        <Route path="trips/new"  element={<ErrorBoundary><NewTripPage /></ErrorBoundary>} />
        <Route path="clients"    element={<ErrorBoundary><ClientsPage /></ErrorBoundary>} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
