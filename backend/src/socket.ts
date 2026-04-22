import type { Server as HttpServer } from "node:http";

import type { MeetingParticipant, User } from "@prisma/client";
import { Server } from "socket.io";
import { z } from "zod";

import { config } from "./config.js";
import { verifyToken } from "./lib/auth.js";
import { prisma } from "./lib/prisma.js";
import { MeetingRuntimeManager } from "./concurrency/MeetingRuntimeManager.js";

const roomSchema = z.object({
  code: z.string().min(4),
});

const simulateTurnSchema = z.object({
  code: z.string().min(4),
  text: z.string().min(1),
  segmentCount: z.number().int().min(1).max(8).default(3),
  startDelayMs: z.number().int().min(0).max(5000).default(0),
  chunkDelayMs: z.number().int().min(50).max(5000).default(400),
  finalDelayMs: z.number().int().min(0).max(5000).default(250),
  failMode: z.enum(["none", "partial", "final"]).default("none"),
});

const transcriptIngestSchema = z.object({
  code: z.string().min(4),
  turnId: z.string().min(4),
  speechStartTime: z.number().int().positive(),
  speechEndTime: z.number().int().positive().optional(),
  chunkIndex: z.number().int().min(0),
  text: z.string().min(1),
  isFinal: z.boolean(),
  processingDelayMs: z.number().int().min(0).max(2000).optional(),
});

const signalSchema = z.object({
  code: z.string().min(4),
  targetSocketId: z.string().min(1),
  sdp: z.any().optional(),
  candidate: z.any().optional(),
});

export function createSocketServer(server: HttpServer) {
  const io = new Server(server, {
    cors: {
      origin: config.clientUrl,
      credentials: true,
    },
  });

  const runtimeManager = new MeetingRuntimeManager(io, prisma);

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token as string | undefined;

      if (!token) {
        next(new Error("Authentication required"));
        return;
      }

      socket.data.auth = verifyToken(token);
      next();
    } catch (error) {
      next(error as Error);
    }
  });

  io.on("connection", (socket) => {
    socket.on("meeting:join-room", async (payload) => {
      const parsed = roomSchema.safeParse(payload);

      if (!parsed.success) {
        socket.emit("error:message", { message: "Invalid room payload" });
        return;
      }

      const meeting = await prisma.meeting.findUnique({
        where: { code: parsed.data.code.toUpperCase() },
      });

      if (!meeting) {
        socket.emit("error:message", { message: "Meeting not found" });
        return;
      }

      const participant = await prisma.meetingParticipant.findUnique({
        where: {
          meetingId_userId: {
            meetingId: meeting.id,
            userId: socket.data.auth.userId,
          },
        },
      });

      if (!participant) {
        socket.emit("error:message", { message: "Join the meeting first" });
        return;
      }

      const updatedParticipant = await prisma.meetingParticipant.update({
        where: { id: participant.id },
        data: { socketId: socket.id, leftAt: null },
      });

      await runtimeManager.attachParticipant(meeting, updatedParticipant);

      socket.join(meeting.code);
      const roomSockets = await io.in(meeting.code).fetchSockets();
      const otherParticipants = await prisma.meetingParticipant.findMany({
        where: {
          meetingId: meeting.id,
          leftAt: null,
          socketId: {
            not: null,
          },
        },
      });

      socket.emit("meeting:room-state", {
        participants: otherParticipants
          .filter((entry) => entry.socketId !== socket.id)
          .map((entry) => normalizeParticipant(entry)),
        peers: roomSockets
          .filter((entry) => entry.id !== socket.id)
          .map((entry) => ({
            socketId: entry.id,
          })),
      });

      io.to(meeting.code).emit("participant:joined", normalizeParticipant(updatedParticipant));
    });

    socket.on("meeting:leave-room", async (payload) => {
      const parsed = roomSchema.safeParse(payload);

      if (!parsed.success) {
        return;
      }

      const meeting = await prisma.meeting.findUnique({
        where: { code: parsed.data.code.toUpperCase() },
      });

      if (!meeting) {
        return;
      }

      const participant = await prisma.meetingParticipant.findUnique({
        where: {
          meetingId_userId: {
            meetingId: meeting.id,
            userId: socket.data.auth.userId,
          },
        },
      });

      if (!participant) {
        return;
      }

      await prisma.meetingParticipant.update({
        where: { id: participant.id },
        data: { leftAt: new Date(), socketId: null },
      });

      await runtimeManager.removeParticipant(meeting.id, participant.id);
      socket.leave(meeting.code);
      io.to(meeting.code).emit("participant:left", normalizeParticipant(participant));
    });

    socket.on("participant:toggle-mute", async (payload) => {
      const parsed = roomSchema.safeParse(payload);

      if (!parsed.success) {
        return;
      }

      const meeting = await prisma.meeting.findUnique({
        where: { code: parsed.data.code.toUpperCase() },
      });

      if (!meeting) {
        return;
      }

      const participant = await prisma.meetingParticipant.findUnique({
        where: {
          meetingId_userId: {
            meetingId: meeting.id,
            userId: socket.data.auth.userId,
          },
        },
      });

      if (!participant) {
        return;
      }

      const updated = await prisma.meetingParticipant.update({
        where: { id: participant.id },
        data: { muted: !participant.muted },
      });

      io.to(meeting.code).emit("participant:updated", normalizeParticipant(updated));
    });

    socket.on("transcript:simulate-turn", async (payload) => {
      const parsed = simulateTurnSchema.safeParse(payload);

      if (!parsed.success) {
        socket.emit("error:message", { message: "Invalid transcript simulation payload" });
        return;
      }

      const meeting = await prisma.meeting.findUnique({
        where: { code: parsed.data.code.toUpperCase() },
      });

      if (!meeting) {
        socket.emit("error:message", { message: "Meeting not found" });
        return;
      }

      const participant = await prisma.meetingParticipant.findUnique({
        where: {
          meetingId_userId: {
            meetingId: meeting.id,
            userId: socket.data.auth.userId,
          },
        },
      });

      if (!participant) {
        socket.emit("error:message", { message: "Participant not found" });
        return;
      }

      await runtimeManager.startSimulatedTurn(meeting, participant, {
        text: parsed.data.text,
        segmentCount: parsed.data.segmentCount,
        startDelayMs: parsed.data.startDelayMs,
        chunkDelayMs: parsed.data.chunkDelayMs,
        finalDelayMs: parsed.data.finalDelayMs,
        failMode: parsed.data.failMode,
      });
    });

    socket.on("transcript:ingest", async (payload) => {
      try {
        const parsed = transcriptIngestSchema.safeParse(payload);

        if (!parsed.success) {
          socket.emit("error:message", { message: "Invalid live transcript payload" });
          return;
        }

        const meeting = await prisma.meeting.findUnique({
          where: { code: parsed.data.code.toUpperCase() },
        });

        if (!meeting) {
          socket.emit("error:message", { message: "Meeting not found" });
          return;
        }

        const participant = await prisma.meetingParticipant.findUnique({
          where: {
            meetingId_userId: {
              meetingId: meeting.id,
              userId: socket.data.auth.userId,
            },
          },
        });

        if (!participant) {
          socket.emit("error:message", { message: "Participant not found" });
          return;
        }

        await runtimeManager.ingestLiveTranscript(meeting, participant, {
          turnId: parsed.data.turnId,
          speechStartTime: parsed.data.speechStartTime,
          speechEndTime: parsed.data.speechEndTime,
          chunkIndex: parsed.data.chunkIndex,
          text: parsed.data.text,
          isFinal: parsed.data.isFinal,
          processingDelayMs: parsed.data.processingDelayMs,
        });
      } catch (error) {
        console.error("live transcript ingest failed", error);
        socket.emit("error:message", {
          message: "Live transcript ingest failed before reaching chat.",
        });
      }
    });

    socket.on("webrtc:offer", async (payload) => {
      const parsed = signalSchema.safeParse(payload);

      if (!parsed.success) {
        return;
      }

      io.to(parsed.data.targetSocketId).emit("webrtc:offer", {
        fromSocketId: socket.id,
        sdp: parsed.data.sdp,
      });
    });

    socket.on("webrtc:answer", async (payload) => {
      const parsed = signalSchema.safeParse(payload);

      if (!parsed.success) {
        return;
      }

      io.to(parsed.data.targetSocketId).emit("webrtc:answer", {
        fromSocketId: socket.id,
        sdp: parsed.data.sdp,
      });
    });

    socket.on("webrtc:ice-candidate", async (payload) => {
      const parsed = signalSchema.safeParse(payload);

      if (!parsed.success) {
        return;
      }

      io.to(parsed.data.targetSocketId).emit("webrtc:ice-candidate", {
        fromSocketId: socket.id,
        candidate: parsed.data.candidate,
      });
    });

    socket.on("simulation:run-demo", async (payload) => {
      const parsed = roomSchema.safeParse(payload);

      if (!parsed.success) {
        return;
      }

      const meeting = await prisma.meeting.findUnique({
        where: { code: parsed.data.code.toUpperCase() },
        include: {
          participants: true,
        },
      });

      if (!meeting || meeting.participants.length === 0) {
        return;
      }

      const demoTurns = meeting.participants.slice(0, 3).map((participant, index) => ({
        participant,
        text:
          index === 0
            ? "I spoke first with a deliberately long sentence so my worker should complete later than some speakers who started after me."
            : index === 1
              ? "Short reply."
              : "I started later, but some of my chunks should still appear before the first speaker finishes.",
        segmentCount: index === 0 ? 4 : 2,
        startDelayMs: index === 0 ? 100 : index === 1 ? 250 : 220,
        chunkDelayMs: index === 0 ? 700 : index === 1 ? 220 : 420,
        finalDelayMs: index === 0 ? 900 : index === 1 ? 150 : 250,
        failMode: "none" as const,
      }));

      for (const demoTurn of demoTurns) {
        await runtimeManager.attachParticipant(meeting, demoTurn.participant);
        await runtimeManager.startSimulatedTurn(meeting, demoTurn.participant, demoTurn);
      }
    });

    socket.on("meeting:end", async (payload) => {
      const parsed = roomSchema.safeParse(payload);

      if (!parsed.success) {
        return;
      }

      const meeting = await prisma.meeting.findUnique({
        where: { code: parsed.data.code.toUpperCase() },
      });

      if (!meeting) {
        return;
      }

      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { isActive: false, endedAt: new Date() },
      });

      await runtimeManager.stopMeeting(meeting.id);
      io.to(meeting.code).emit("meeting:ended", { code: meeting.code });
    });

    socket.on("disconnect", async () => {
      const participant = await prisma.meetingParticipant.findFirst({
        where: {
          socketId: socket.id,
        },
        include: {
          meeting: true,
        },
      });

      if (!participant) {
        return;
      }

      await prisma.meetingParticipant.update({
        where: { id: participant.id },
        data: { leftAt: new Date(), socketId: null },
      });

      await runtimeManager.removeParticipant(participant.meetingId, participant.id);
      io.to(participant.meeting.code).emit("participant:left", normalizeParticipant(participant));
    });
  });

  return io;
}

function normalizeParticipant(participant: Pick<MeetingParticipant, "id" | "displayName" | "muted">) {
  return {
    id: participant.id,
    displayName: participant.displayName,
    muted: participant.muted,
    socketId: "socketId" in participant ? participant.socketId : undefined,
  };
}
