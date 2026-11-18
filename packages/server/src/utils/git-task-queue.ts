import { AsyncResource } from "node:async_hooks";
import type { GitProcessPriority } from "./git-process-scheduler.js";

export class GitTaskQueue {
  private readonly pending: Array<{
    priority: () => GitProcessPriority;
    run: () => Promise<void>;
    reject: (error: unknown) => void;
  }> = [];
  private running = 0;

  constructor(private readonly concurrency: number) {}

  get activeCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  run<T>(
    operation: () => T | Promise<T>,
    options: { priority: () => GitProcessPriority },
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        priority: options.priority,
        reject,
        // A different submitter's completion can release this task's slot.
        run: AsyncResource.bind(async () => {
          try {
            resolve(await operation());
          } catch (error) {
            reject(error);
          }
        }),
      });
      this.drain();
    });
  }

  clearQueue(): void {
    const error = AbortSignal.abort().reason;
    for (const task of this.pending.splice(0)) task.reject(error);
  }

  private drain(): void {
    while (this.running < this.concurrency && this.pending.length) {
      let index = this.pending.findIndex((task) => task.priority() === "high");
      if (index < 0) index = this.pending.findIndex((task) => task.priority() === "normal");
      const [task] = this.pending.splice(index < 0 ? 0 : index, 1);
      this.running += 1;
      void Promise.resolve()
        .then(task.run)
        .finally(() => {
          this.running -= 1;
          this.drain();
        });
    }
  }
}
