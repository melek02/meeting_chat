import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { token, isAuthReady } = useAuth();

  if (!isAuthReady) {
    return <div style={{ padding: 24 }}>Restoring session...</div>;
  }

  if (!token) {
    return <Navigate to="/signin" replace />;
  }

  return <>{children}</>;
}
