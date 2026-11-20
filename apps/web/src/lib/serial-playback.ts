/**
 * Runs simulated time in serialized steps. A new tick is scheduled only
 * after the previous HTTP advance has completed.
 *
 * This is a demo pacing controller, not a wall-clock accurate simulator.
 */
export interface PlaybackScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface SerialPlaybackOptions {
  readonly step: () => Promise<boolean>;
  readonly onStop?: () => void;
  readonly onError?: (error: unknown) => void;
  readonly delayMs?: number;
  readonly scheduler?: PlaybackScheduler;
}

export interface SerialPlaybackController {
  start(): void;
  pause(): void;
  dispose(): void;
  isRunning(): boolean;
}

const realScheduler: PlaybackScheduler = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createSerialPlayback({
  step,
  onStop,
  onError,
  delayMs = 1000,
  scheduler = realScheduler,
}: SerialPlaybackOptions): SerialPlaybackController {
  if (!Number.isFinite(delayMs) || delayMs <= 0 || !Number.isSafeInteger(delayMs)) {
    throw new RangeError('Playback interval must be a positive integer');
  }

  let running = false;
  let disposed = false;
  let pending = false;
  let timer: unknown = null;

  function cancelTimer(): void {
    if (timer !== null) {
      scheduler.cancel(timer);
      timer = null;
    }
  }

  function scheduleNext(): void {
    if (!running || disposed || pending || timer !== null) return;
    timer = scheduler.schedule(() => {
      timer = null;
      void tick();
    }, delayMs);
  }

  async function tick(): Promise<void> {
    if (disposed || !running || pending) return;
    pending = true;
    try {
      const shouldContinue = await step();
      if (!disposed && running && !shouldContinue) {
        running = false;
        onStop?.();
      }
    } catch (error) {
      if (!disposed && running) {
        running = false;
        onError?.(error);
      }
    } finally {
      pending = false;
      scheduleNext();
    }
  }

  return {
    start() {
      if (disposed || running) return;
      running = true;
      scheduleNext();
    },
    pause() {
      running = false;
      cancelTimer();
    },
    dispose() {
      running = false;
      disposed = true;
      cancelTimer();
    },
    isRunning() {
      return running;
    },
  };
}
