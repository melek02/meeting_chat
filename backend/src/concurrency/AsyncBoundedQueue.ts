export class AsyncBoundedQueue<T> {
  private readonly items: T[] = [];

  private readonly dequeueWaiters: Array<(item: T) => void> = [];

  private readonly enqueueWaiters: Array<() => void> = [];

  constructor(private readonly capacity = 256) {}

  size() {
    return this.items.length;
  }

  async enqueue(item: T) {
    if (this.dequeueWaiters.length > 0) {
      const resolve = this.dequeueWaiters.shift();
      resolve?.(item);
      return;
    }

    while (this.items.length >= this.capacity) {
      await new Promise<void>((resolve) => {
        this.enqueueWaiters.push(resolve);
      });
    }

    this.items.push(item);
  }

  async dequeue(): Promise<T> {
    if (this.items.length > 0) {
      const item = this.items.shift() as T;
      const resumeEnqueue = this.enqueueWaiters.shift();
      resumeEnqueue?.();
      return item;
    }

    return new Promise<T>((resolve) => {
      this.dequeueWaiters.push(resolve);
    });
  }
}
