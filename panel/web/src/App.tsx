import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { UIProvider } from './ui';
import Login from './pages/Login';
import AppShell from './AppShell';
import type { ReactNode } from 'react';

function Splash() {
  return (
    <div className="center-screen">
      <div className="spinner" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc }} />;
  return <>{children}</>;
}

function Shell() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <UIProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </UIProvider>
  );
}
