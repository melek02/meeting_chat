import type { TurnStatus } from "@prisma/client";

export type ParticipantWorkerCommand =
  | {
      type: "PROCESS_TURN";
      payload: {
        meetingId: string;
        meetingCode: string;
        participantId: string;
        participantName: string;
        turnId: string;
        sequenceNumber: number;
        speechStartTime: number;
        text: string;
        segmentCount: number;
        startDelayMs: number;
        chunkDelayMs: number;
        finalDelayMs: number;
        failMode: "none" | "partial" | "final";
      };
    }
  | {
      type: "INGEST_LIVE_TRANSCRIPT";
      payload: {
        meetingId: string;
        meetingCode: string;
        participantId: string;
        participantName: string;
        turnId: string;
        speechStartTime: number;
        speechEndTime?: number;
        chunkIndex: number;
        text: string;
        isFinal: boolean;
        processingDelayMs?: number;
      };
    };

export type WorkerTranscriptEvent =
  | {
      type: "TRANSCRIPT_PARTIAL";
      payload: WorkerTranscriptPayload;
    }
  | {
      type: "TRANSCRIPT_FINAL";
      payload: WorkerTranscriptPayload;
    }
  | {
      type: "WORKER_FAILURE";
      payload: WorkerTranscriptPayload & {
        failureStage: "after-first-partial" | "before-final";
      };
    };

export type WorkerTranscriptPayload = {
  meetingId: string;
  meetingCode: string;
  participantId: string;
  participantName: string;
  turnId: string;
  sequenceNumber?: number;
  speechStartTime: number;
  speechEndTime?: number;
  chunkIndex: number;
  text: string;
  createdAt: number;
  isFinal: boolean;
};

export type OrderedTranscriptItem = {
  turnId: string;
  participantId: string;
  participantName: string;
  sequenceNumber: number;
  speechStartTime: number;
  speechEndTime?: number;
  text: string;
  isFinal: boolean;
  status: TurnStatus;
  chunkIndex: number;
};

export type OrderedTranscriptSnapshot = {
  meetingId: string;
  meetingCode: string;
  items: OrderedTranscriptItem[];
  queueDepth: number;
  mergedAt: number;
  changedItem?: OrderedTranscriptItem;
};