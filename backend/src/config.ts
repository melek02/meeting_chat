import dotenv from "dotenv";

dotenv.config();

function parseIceServers() {
  const rawIceServers = process.env.RTC_ICE_SERVERS;

  if (!rawIceServers) {
    return [
      {
        urls: ["stun:stun.l.google.com:19302"],
      },
    ];
  }

  try {
    const parsed = JSON.parse(rawIceServers);

    if (!Array.isArray(parsed)) {
      throw new Error("RTC_ICE_SERVERS must be a JSON array");
    }

    return parsed;
  } catch (error) {
    console.error("Failed to parse RTC_ICE_SERVERS, falling back to default STUN server.", error);
    return [
      {
        urls: ["stun:stun.l.google.com:19302"],
      },
    ];
  }
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "change-me",
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:5173",
  rtcIceServers: parseIceServers(),
};
