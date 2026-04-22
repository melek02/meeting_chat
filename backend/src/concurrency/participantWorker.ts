import { parentPort } from "node:worker_threads";

import type { ParticipantWorkerCommand } from "./types.js";

const sleep = (durationMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });

function chunkText(text: string, segmentCount: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return [text];
  }

  const size = Math.max(1, Math.ceil(words.length / Math.max(1, segmentCount)));
  const chunks: string[] = [];

  for (let index = 0; index < words.length; index += size) {
    chunks.push(words.slice(index, index + size).join(" "));
  }

  return chunks;
}

async function handleCommand(command: ParticipantWorkerCommand) {
  if (command.type === "INGEST_LIVE_TRANSCRIPT") {
    const {
      meetingId,
      meetingCode,
      participantId,
      participantName,
      turnId,
      speechStartTime,
      speechEndTime,
      chunkIndex,
      text,
      isFinal,
      processingDelayMs,
    } = command.payload;

    if (processingDelayMs && processingDelayMs > 0) {
      await sleep(processingDelayMs);
    }

    parentPort?.postMessage({
      type: isFinal ? "TRANSCRIPT_FINAL" : "TRANSCRIPT_PARTIAL",
      payload: {
        meetingId,
        meetingCode,
        participantId,
        participantName,
        turnId,
        speechStartTime,
        speechEndTime,
        chunkIndex,
        text,
        createdAt: Date.now(),
        isFinal,
      },
    });
    return;
  }

  if (command.type !== "PROCESS_TURN") {
    return;
  }

  const {
    meetingId,
    meetingCode,
    participantId,
    participantName,
    turnId,
    sequenceNumber,
    speechStartTime,
    text,
    segmentCount,
    startDelayMs,
    chunkDelayMs,
    finalDelayMs,
    failMode,
  } = command.payload;

  await sleep(startDelayMs);

  const chunks = chunkText(text, segmentCount);
  let accumulatedText = "";

  for (let index = 0; index < chunks.length; index += 1) {
    await sleep(chunkDelayMs);
    accumulatedText = accumulatedText ? `${accumulatedText} ${chunks[index]}` : chunks[index];

    parentPort?.postMessage({
      type: "TRANSCRIPT_PARTIAL",
      payload: {
        meetingId,
        meetingCode,
        participantId,
        participantName,
        turnId,
        sequenceNumber,
        speechStartTime,
        chunkIndex: index,
        text: accumulatedText,
        createdAt: Date.now(),
        isFinal: false,
      },
    });

    if (failMode === "partial" && index === 0) {
      parentPort?.postMessage({
        type: "WORKER_FAILURE",
        payload: {
          meetingId,
          meetingCode,
          participantId,
          participantName,
          turnId,
          sequenceNumber,
          speechStartTime,
          chunkIndex: index,
          text: accumulatedText,
          createdAt: Date.now(),
          isFinal: false,
          failureStage: "after-first-partial",
        },
      });
      return;
    }
  }

  await sleep(finalDelayMs);

  if (failMode === "final") {
    parentPort?.postMessage({
      type: "WORKER_FAILURE",
      payload: {
        meetingId,
        meetingCode,
        participantId,
        participantName,
        turnId,
        sequenceNumber,
        speechStartTime,
        chunkIndex: chunks.length - 1,
        text: accumulatedText,
        createdAt: Date.now(),
        isFinal: false,
        failureStage: "before-final",
      },
    });
    return;
  }

  parentPort?.postMessage({
    type: "TRANSCRIPT_FINAL",
    payload: {
      meetingId,
      meetingCode,
      participantId,
      participantName,
      turnId,
      sequenceNumber,
      speechStartTime,
      speechEndTime: Date.now(),
      chunkIndex: chunks.length - 1,
      text: accumulatedText,
      createdAt: Date.now(),
      isFinal: true,
    },
  });
}

let participantQueue = Promise.resolve();

parentPort?.on("message", (command: ParticipantWorkerCommand) => {
  participantQueue = participantQueue.then(() => handleCommand(command));
});
