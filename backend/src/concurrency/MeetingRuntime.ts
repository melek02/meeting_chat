import type { MeetingParticipant, PrismaClient, TurnStatus } from "@prisma/client";
import { Server } from "socket.io";

import { AsyncBoundedQueue } from "./AsyncBoundedQueue.js";
import { ParticipantProcessor } from "./ParticipantProcessor.js";
import type {
  OrderedTranscriptItem,
  OrderedTranscriptSnapshot,
  ParticipantWorkerCommand,
  WorkerTranscriptEvent,
} from "./types.js";

type RuntimeParticipant = Pick<MeetingParticipant, "id" | "displayName" | "muted">;

type TurnMemoryState = {
  turnId: string;
  meetingParticipantId: string;
  participantName: string;
  sequenceNumber: number;
  speechStartTime: number;
  speechEndTime?: number;
  status: TurnStatus;
  text: string;
  chunkIndex: number;
};

type StartTurnInput = {
  participant: RuntimeParticipant;
  text: string;
  segmentCount: number;
  startDelayMs: number;
  chunkDelayMs: number;
  finalDelayMs: number;
  failMode: "none" | "partial" | "final";
};

type IngestLiveTranscriptInput = {
  participant: RuntimeParticipant;
  turnId: string;
  speechStartTime: number;
  speechEndTime?: number;
  chunkIndex: number;
  text: string;
  isFinal: boolean;
  processingDelayMs?: number;
};

export class MeetingRuntime {
  private readonly participantProcessors = new Map<string, ParticipantProcessor>();

  private readonly inboundQueue = new AsyncBoundedQueue<WorkerTranscriptEvent>(512);

  private readonly outboundQueue = new AsyncBoundedQueue<OrderedTranscriptSnapshot>(512);

  private readonly turns = new Map<string, TurnMemoryState>();

  private readonly liveTurnInitialization = new Map<string, Promise<void>>();

  private nextSequenceNumber = 1;

  private activeParticipantId: string | null = null;

  private running = true;

  constructor(
    private readonly io: Server,
    private readonly prisma: PrismaClient,
    public readonly meetingId: string,
    public readonly meetingCode: string
  ) {
    void this.coordinatorLoop();
    void this.broadcasterLoop();
  }

  ensureParticipantProcessor(participant: RuntimeParticipant) {
    if (this.participantProcessors.has(participant.id)) {
      return;
    }

    const processor = new ParticipantProcessor({
      participantId: participant.id,
      participantName: participant.displayName,
      onEvent: async (event) => {
        await this.inboundQueue.enqueue(event);
      },
    });

    this.participantProcessors.set(participant.id, processor);
  }

  async removeParticipant(participantId: string) {
    const processor = this.participantProcessors.get(participantId);

    if (processor) {
      await processor.shutdown();
      this.participantProcessors.delete(participantId);
    }

    if (this.activeParticipantId === participantId) {
      this.activeParticipantId = null;
      this.io.to(this.meetingCode).emit("active-speaker:changed", {
        participantId: null,
      });
    }
  }

  async startTurn(input: StartTurnInput) {
    this.ensureParticipantProcessor(input.participant);

    const speechStartTime = Date.now() + input.startDelayMs;
    const sequenceNumber = this.nextSequenceNumber++;

    const turn = await this.prisma.speechTurn.create({
      data: {
        meetingId: this.meetingId,
        meetingParticipantId: input.participant.id,
        sequenceNumber,
        speechStartTime: new Date(speechStartTime),
        status: "PENDING",
      },
    });

    this.turns.set(turn.id, {
      turnId: turn.id,
      meetingParticipantId: input.participant.id,
      participantName: input.participant.displayName,
      sequenceNumber,
      speechStartTime,
      status: "PENDING",
      text: "",
      chunkIndex: -1,
    });

    this.activeParticipantId = input.participant.id;
    this.io.to(this.meetingCode).emit("active-speaker:changed", {
      participantId: input.participant.id,
      turnId: turn.id,
    });

    const command: ParticipantWorkerCommand = {
      type: "PROCESS_TURN",
      payload: {
        meetingId: this.meetingId,
        meetingCode: this.meetingCode,
        participantId: input.participant.id,
        participantName: input.participant.displayName,
        turnId: turn.id,
        sequenceNumber,
        speechStartTime,
        text: input.text,
        segmentCount: input.segmentCount,
        startDelayMs: input.startDelayMs,
        chunkDelayMs: input.chunkDelayMs,
        finalDelayMs: input.finalDelayMs,
        failMode: input.failMode,
      },
    };

    const processor = this.participantProcessors.get(input.participant.id);
    await processor?.process(command);
  }

  async ingestLiveTranscript(input: IngestLiveTranscriptInput) {
    this.ensureParticipantProcessor(input.participant);
    await this.ensureLiveTurnInitialized(input);

    this.activeParticipantId = input.participant.id;
    this.io.to(this.meetingCode).emit("active-speaker:changed", {
      participantId: input.participant.id,
      turnId: input.turnId,
    });

    const processor = this.participantProcessors.get(input.participant.id);
    await processor?.process({
      type: "INGEST_LIVE_TRANSCRIPT",
      payload: {
        meetingId: this.meetingId,
        meetingCode: this.meetingCode,
        participantId: input.participant.id,
        participantName: input.participant.displayName,
        turnId: input.turnId,
        speechStartTime: input.speechStartTime,
        speechEndTime: input.speechEndTime,
        chunkIndex: input.chunkIndex,
        text: input.text,
        isFinal: input.isFinal,
        processingDelayMs: input.processingDelayMs,
      },
      });
  }

  private async ensureLiveTurnInitialized(input: IngestLiveTranscriptInput) {
    if (this.turns.has(input.turnId)) {
      return;
    }

    const existingInitialization = this.liveTurnInitialization.get(input.turnId);

    if (existingInitialization) {
      await existingInitialization;
      return;
    }

    const initializationPromise = this.initializeLiveTurn(input);
    this.liveTurnInitialization.set(input.turnId, initializationPromise);

    try {
      await initializationPromise;
    } finally {
      this.liveTurnInitialization.delete(input.turnId);
    }
  }

  private async initializeLiveTurn(input: IngestLiveTranscriptInput) {
    if (this.turns.has(input.turnId)) {
      return;
    }

    const sequenceNumber = this.nextSequenceNumber++;

    this.turns.set(input.turnId, {
      turnId: input.turnId,
      meetingParticipantId: input.participant.id,
      participantName: input.participant.displayName,
      sequenceNumber,
      speechStartTime: input.speechStartTime,
      status: "PENDING",
      text: "",
      chunkIndex: -1,
    });

    try {
      await this.prisma.speechTurn.upsert({
        where: {
          id: input.turnId,
        },
        update: {
          meetingParticipantId: input.participant.id,
          speechStartTime: new Date(input.speechStartTime),
        },
        create: {
          id: input.turnId,
          meetingId: this.meetingId,
          meetingParticipantId: input.participant.id,
          sequenceNumber,
          speechStartTime: new Date(input.speechStartTime),
          status: "PENDING",
        },
      });
    } catch (error) {
      this.turns.delete(input.turnId);
      throw error;
    }
  }

  async stop() {
    this.running = false;
    const processors = Array.from(this.participantProcessors.values());
    await Promise.all(processors.map((processor) => processor.shutdown()));
  }

  private async coordinatorLoop() {
    while (this.running) {
      const event = await this.inboundQueue.dequeue();
      await this.mergeWorkerEvent(event);
      await this.outboundQueue.enqueue({
        meetingId: this.meetingId,
        meetingCode: this.meetingCode,
        items: this.getOrderedTranscript(),
        queueDepth: this.inboundQueue.size(),
        mergedAt: Date.now(),
        changedItem: this.turnToOrderedItem(this.turns.get(event.payload.turnId) ?? null),
      });
    }
  }

  private async broadcasterLoop() {
    while (this.running) {
      const snapshot = await this.outboundQueue.dequeue();

      this.io.to(this.meetingCode).emit("transcript:snapshot", snapshot);

      if (snapshot.changedItem && snapshot.changedItem.isFinal) {
        this.io.to(this.meetingCode).emit("transcript:final", snapshot.changedItem);
      } else if (snapshot.changedItem) {
        this.io.to(this.meetingCode).emit("transcript:partial", snapshot.changedItem);
      }
    }
  }

  private async mergeWorkerEvent(event: WorkerTranscriptEvent) {
    const turn = this.turns.get(event.payload.turnId);

    if (!turn) {
      return;
    }

    let status: TurnStatus = "PARTIAL";
    let speechEndTime: number | undefined;

    if (event.type === "TRANSCRIPT_FINAL") {
      status = "FINAL";
      speechEndTime = event.payload.speechEndTime;
    }

    if (event.type === "WORKER_FAILURE") {
      status = "FAILED";
      this.activeParticipantId = null;
      this.io.to(this.meetingCode).emit("active-speaker:changed", {
        participantId: null,
      });
    }

    turn.text = event.payload.text;
    turn.chunkIndex = event.payload.chunkIndex;
    if (event.payload.sequenceNumber && turn.sequenceNumber !== event.payload.sequenceNumber) {
      turn.sequenceNumber = event.payload.sequenceNumber;
    }
    turn.status = status;
    turn.speechEndTime = speechEndTime;

    await this.prisma.transcriptSegment.create({
      data: {
        speechTurnId: turn.turnId,
        chunkIndex: event.payload.chunkIndex,
        text: event.payload.text,
        isFinal: event.type === "TRANSCRIPT_FINAL",
        processingCompletedAt: new Date(event.payload.createdAt),
      },
    });

    await this.prisma.speechTurn.update({
      where: {
        id: turn.turnId,
      },
      data: {
        latestText: event.payload.text,
        status,
        speechEndTime: speechEndTime ? new Date(speechEndTime) : undefined,
      },
    });

    if (status === "FINAL") {
      this.activeParticipantId = null;
      this.io.to(this.meetingCode).emit("active-speaker:changed", {
        participantId: null,
      });
    }
  }

  private getOrderedTranscript(): OrderedTranscriptItem[] {
    return Array.from(this.turns.values())
      .sort((left, right) => {
        if (left.speechStartTime !== right.speechStartTime) {
          return left.speechStartTime - right.speechStartTime;
        }

        return left.sequenceNumber - right.sequenceNumber;
      })
      .map((turn) => this.turnToOrderedItem(turn))
      .filter((turn): turn is OrderedTranscriptItem => Boolean(turn));
  }

  private turnToOrderedItem(turn: TurnMemoryState | null): OrderedTranscriptItem | undefined {
    if (!turn) {
      return undefined;
    }

    return {
      turnId: turn.turnId,
      participantId: turn.meetingParticipantId,
      participantName: turn.participantName,
      sequenceNumber: turn.sequenceNumber,
      speechStartTime: turn.speechStartTime,
      speechEndTime: turn.speechEndTime,
      text: turn.text,
      isFinal: turn.status === "FINAL",
      status: turn.status,
      chunkIndex: turn.chunkIndex,
    };
  }
}
