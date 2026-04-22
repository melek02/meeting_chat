import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { config } from "../config.js";

export type AuthTokenPayload = {
  userId: string;
  email: string;
  name: string;
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function signToken(payload: AuthTokenPayload) {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: "7d",
  });
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, config.jwtSecret) as AuthTokenPayload;
}
