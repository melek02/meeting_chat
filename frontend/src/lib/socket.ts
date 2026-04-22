import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;
let currentToken: string | null = null;

export function getSocket(token: string) {
  if (socket && currentToken === token && socket.connected) {
    return socket;
  }

  // Disconnect stale socket before creating a new one
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  currentToken = token;
    socket = io(import.meta.env.VITE_API_URL ?? "http://localhost:4000", {
    auth: { token },
  });

  return socket;
}

export function resetSocket() {
  socket?.disconnect();
  socket = null;
  currentToken = null;
}