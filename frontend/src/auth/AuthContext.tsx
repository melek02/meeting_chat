import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { AuthResponse, AuthUser } from "../types";
import { api } from "../lib/api";
import { resetSocket } from "../lib/socket";

type AuthContextValue = {
  token: string | null;
  user: AuthUser | null;
  isAuthReady: boolean;
  signIn: (response: AuthResponse) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = "thread-meeting-auth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    async function bootstrapAuth() {
      const saved = window.localStorage.getItem(STORAGE_KEY);

      if (!saved) {
        setIsAuthReady(true);
        return;
      }

      try {
        const parsed = JSON.parse(saved) as AuthResponse;
        const currentUser = await api.getCurrentUser(parsed.token);
        setToken(parsed.token);
        setUser(currentUser);
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            token: parsed.token,
            user: currentUser,
          } satisfies AuthResponse)
        );
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
        setToken(null);
        setUser(null);
        resetSocket();
      } finally {
        setIsAuthReady(true);
      }
    }

    void bootstrapAuth();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      isAuthReady,
      signIn: (response) => {
        setToken(response.token);
        setUser(response.user);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(response));
        setIsAuthReady(true);
      },
      signOut: () => {
        setToken(null);
        setUser(null);
        window.localStorage.removeItem(STORAGE_KEY);
        resetSocket();
        setIsAuthReady(true);
      },
    }),
    [isAuthReady, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
