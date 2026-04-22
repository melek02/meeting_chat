import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { HomePage } from "./pages/HomePage";
import { MeetingPage } from "./pages/MeetingPage";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";

export function App() {
  const { token, isAuthReady } = useAuth();

  if (!isAuthReady) {
    return <div style={{ padding: 24 }}>Loading app...</div>;
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to={token ? "/home" : "/signin"} replace />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/signin" element={<SignInPage />} />
      <Route
        path="/home"
        element={
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/meeting/:code"
        element={
          <ProtectedRoute>
            <MeetingPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
