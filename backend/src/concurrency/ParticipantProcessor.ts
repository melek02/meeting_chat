import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

import type { ParticipantWorkerCommand, WorkerTranscriptEvent } from "./types.js";

type ParticipantProcessorOptions = {
  participantId: string;
  participantName: string;
  onEvent: (event: WorkerTranscriptEvent) => Promise<void>;
};

export class ParticipantProcessor {
  private readonly worker: Worker;

  constructor(private readonly options: ParticipantProcessorOptions) {
    const currentFilePath = fileURLToPath(import.meta.url);
    const tsRuntime = currentFilePath.endsWith(".ts");
    const workerUrl = new URL(
      tsRuntime ? "./participantWorker.ts" : "./participantWorker.js",
      import.meta.url
    );

    this.worker = new Worker(fileURLToPath(workerUrl), {
      execArgv: tsRuntime ? ["--import", "tsx"] : undefined,
    });

    this.worker.on("message", (event: WorkerTranscriptEvent) => {
      void this.options.onEvent(event);
    });

    this.worker.on("error", (error) => {
      console.error(
        `participant worker failed for ${this.options.participantName} (${this.options.participantId})`,
        error
      );
    });
  }

  async process(command: ParticipantWorkerCommand) {
    this.worker.postMessage(command);
  }

  async shutdown() {
    await this.worker.terminate();
  }
}
