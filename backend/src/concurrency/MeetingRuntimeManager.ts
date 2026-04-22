import type { Meeting, MeetingParticipant, PrismaClient } from "@prisma/client";
import type { Server } from "socket.io";

import { MeetingRuntime } from "./MeetingRuntime.js";

type RuntimeMeeting = Pick<Meeting, "id" | "code">;
type RuntimeParticipant = Pick<MeetingParticipant, "id" | "displayName" | "muted">;

export class MeetingRuntimeManager {
  private readonly runtimes = new Map<string, MeetingRuntime>();

  constructor(private readonly io: Server, private readonly prisma: PrismaClient) {}

  getOrCreateRuntime(meeting: RuntimeMeeting) {
    const existing = this.runtimes.get(meeting.id);

    if (existing) {
      return existing;
    }

    const runtime = new MeetingRuntime(this.io, this.prisma, meeting.id, meeting.code);
    this.runtimes.set(meeting.id, runtime);
    return runtime;
  }

  async attachParticipant(meeting: RuntimeMeeting, participant: RuntimeParticipant) {
    const runtime = this.getOrCreateRuntime(meeting);
    runtime.ensureParticipantProcessor(participant);
  }

  async removeParticipant(meetingId: string, participantId: string) {
    const runtime = this.runtimes.get(meetingId);

    if (!runtime) {
      return;
    }

    await runtime.removeParticipant(participantId);
  }

  async startSimulatedTurn(
    meeting: RuntimeMeeting,
    participant: RuntimeParticipant,
    input: {
      text: string;
      segmentCount: number;
      startDelayMs: number;
      chunkDelayMs: number;
      finalDelayMs: number;
      failMode: "none" | "partial" | "final";
    }
  ) {
    const runtime = this.getOrCreateRuntime(meeting);
    await runtime.startTurn({
      participant,
      text: input.text,
      segmentCount: input.segmentCount,
      startDelayMs: input.startDelayMs,
      chunkDelayMs: input.chunkDelayMs,
      finalDelayMs: input.finalDelayMs,
      failMode: input.failMode,
    });
  }

  async ingestLiveTranscript(
    meeting: RuntimeMeeting,
    participant: RuntimeParticipant,
    input: {
      turnId: string;
      speechStartTime: number;
      speechEndTime?: number;
      chunkIndex: number;
      text: string;
      isFinal: boolean;
      processingDelayMs?: number;
    }
  ) {
    const runtime = this.getOrCreateRuntime(meeting);
    await runtime.ingestLiveTranscript({
      participant,
      turnId: input.turnId,
      speechStartTime: input.speechStartTime,
      speechEndTime: input.speechEndTime,
      chunkIndex: input.chunkIndex,
      text: input.text,
      isFinal: input.isFinal,
      processingDelayMs: input.processingDelayMs,
    });
  }

  async stopMeeting(meetingId: string) {
    const runtime = this.runtimes.get(meetingId);

    if (!runtime) {
      return;
    }

    await runtime.stop();
    this.runtimes.delete(meetingId);
  }
}
