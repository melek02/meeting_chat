import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "../middleware/auth.js";
import { hashPassword, signToken, verifyPassword } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2).optional(),
});

router.post("/signup", async (request, response) => {
  const parsed = authSchema.safeParse(request.body);

  if (!parsed.success || !parsed.data.name) {
    response.status(400).json({ error: "Invalid sign up payload" });
    return;
  }

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });

  if (existing) {
    response.status(409).json({ error: "Email already exists" });
    return;
  }

  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password),
    },
  });

  response.json({
    token: signToken({
      userId: user.id,
      email: user.email,
      name: user.name,
    }),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  });
});

router.post("/signin", async (request, response) => {
  const parsed = authSchema.omit({ name: true }).safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: "Invalid sign in payload" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });

  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    response.status(401).json({ error: "Invalid credentials" });
    return;
  }

  response.json({
    token: signToken({
      userId: user.id,
      email: user.email,
      name: user.name,
    }),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  });
});

router.get("/me", requireAuth, async (request, response) => {
  const auth = request.auth!;

  const user = await prisma.user.findUnique({
    where: {
      id: auth.userId,
    },
  });

  if (!user) {
    response.status(404).json({ error: "User not found" });
    return;
  }

  response.json({
    id: user.id,
    email: user.email,
    name: user.name,
  });
});

export const authRouter = router;
