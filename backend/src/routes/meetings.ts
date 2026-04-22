import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

function generateMeetingCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

const joinSchema = z.object({
  code: z.string().min(4),
});

router.post("/", requireAuth, async (request, response) => {
  const auth = request.auth!;
  let code = generateMeetingCode();

  while (await prisma.meeting.findUnique({ where: { code } })) {
    code = generateMeetingCode();
  }

  const meeting = await prisma.meeting.create({
    data: {
      code,
      title: `Meeting ${code}`,
      createdById: auth.userId,
      participants: {
        create: {
          userId: auth.userId,
          displayName: auth.name,
        },
      },
    },
    include: {
      participants: true,
    },
  });

  response.json(meeting);
});

router.post("/join", requireAuth, async (request, response) => {
  const auth = request.auth!;
  const parsed = joinSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: "Invalid meeting code" });
    return;
  }

  const meeting = await prisma.meeting.findUnique({
    where: { code: parsed.data.code.toUpperCase() },
    include: {
      participants: true,
    },
  });

  if (!meeting || !meeting.isActive) {
    response.status(404).json({ error: "Meeting not found" });
    return;
  }

  const participant = await prisma.meetingParticipant.upsert({
    where: {
      meetingId_userId: {
        meetingId: meeting.id,
        userId: auth.userId,
      },
    },
    update: {
      leftAt: null,
      displayName: auth.name,
    },
    create: {
      meetingId: meeting.id,
      userId: auth.userId,
      displayName: auth.name,
    },
  });

  response.json({
    meeting,
    participant,
  });
});

router.get("/:code", requireAuth, async (request, response) => {
  const meeting = await prisma.meeting.findUnique({
      where: { code: (request.params.code as string).toUpperCase() },    include: {
      participants: {
        include: {
          user: true,
        },
      },
    },
  });

  if (!meeting) {
    response.status(404).json({ error: "Meeting not found" });
    return;
  }

  response.json(meeting);
});

router.get("/:code/transcript", requireAuth, async (request, response) => {
  const meeting = await prisma.meeting.findUnique({
    where: { code: (request.params.code as string).toUpperCase() },
  });

  if (!meeting) {
    response.status(404).json({ error: "Meeting not found" });
    return;
  }

  const turns = await prisma.speechTurn.findMany({
    where: {
      meetingId: meeting.id,
    },
    include: {
      meetingParticipant: true,
      transcriptSegments: {
        orderBy: {
          chunkIndex: "asc",
        },
      },
    },
    orderBy: [
      { speechStartTime: "asc" },
      { sequenceNumber: "asc" },
    ],
  });

  response.json(turns);
});

export const meetingRouter = router;
