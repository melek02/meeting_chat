import cors from "cors";
import express from "express";

import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { meetingRouter } from "./routes/meetings.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: config.clientUrl,
      credentials: true,
    })
  );
  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.use("/auth", authRouter);
  app.use("/meetings", meetingRouter);

  return app;
}
