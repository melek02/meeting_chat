import type { NextFunction, Request, Response } from "express";

import { verifyToken } from "../lib/auth.js";

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  const header = request.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const token = header.slice("Bearer ".length);
    request.auth = verifyToken(token);
    next();
  } catch {
    response.status(401).json({ error: "Invalid token" });
  }
}
