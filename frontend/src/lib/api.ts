import type { AuthResponse, AuthUser, Meeting, TranscriptHistoryTurn } from "../types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

type RequestOptions = RequestInit & {
  token?: string | null;
};

async function request<T>(path: string, options: RequestOptions = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errorBody?.error ?? "Request failed");
  }

  return (await response.json()) as T;
}

export const api = {
  signUp: (body: { name: string; email: string; password: string }) =>
    request<AuthResponse>("/auth/signup", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  signIn: (body: { email: string; password: string }) =>
    request<AuthResponse>("/auth/signin", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getCurrentUser: (token: string) =>
    request<AuthUser>("/auth/me", {
      token,
    }),
  createMeeting: (token: string) =>
    request<Meeting>("/meetings", {
      method: "POST",
      token,
    }),
  joinMeeting: (token: string, code: string) =>
    request<{ meeting: Meeting }>("/meetings/join", {
      method: "POST",
      token,
      body: JSON.stringify({ code }),
    }),
  getMeeting: (token: string, code: string) =>
    request<Meeting>(`/meetings/${code}`, {
      token,
    }),
  getTranscript: (token: string, code: string) =>
    request<TranscriptHistoryTurn[]>(`/meetings/${code}/transcript`, {
      token,
    }),
};
