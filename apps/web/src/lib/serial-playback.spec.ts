import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSerialPlayback } from './serial-playback';

const wait = () => Promise.resolve();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('serial simulation playback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('does not advance until started', async () => {
    const step = vi.fn().mockResolvedValue(true);
    const controller = createSerialPlayback({ step });
    await vi.advanceTimersByTimeAsync(5000);
    expect(step).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('advances once after the configured delay', async () => {
    const step = vi.fn().mockResolvedValue(true);
    const controller = createSerialPlayback({ step, delayMs: 250 });
    controller.start();
    await vi.advanceTimersByTimeAsync(249);
    expect(step).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(step).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('never overlaps slow advances', async () => {
    const slow = deferred<boolean>();
    const step = vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValue(true);
    const controller = createSerialPlayback({ step });
    controller.start();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(7000);
    expect(step).toHaveBeenCalledTimes(1);
    slow.resolve(true);
    await wait();
    await wait();
    await vi.advanceTimersByTimeAsync(1000);
    expect(step).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('pauses without issuing queued advances', async () => {
    const step = vi.fn().mockResolvedValue(true);
    const controller = createSerialPlayback({ step });
    controller.start();
    await vi.advanceTimersByTimeAsync(1000);
    controller.pause();
    await vi.advanceTimersByTimeAsync(5000);
    expect(step).toHaveBeenCalledTimes(1);
    expect(controller.isRunning()).toBe(false);
    controller.dispose();
  });

  it('does not schedule another request if paused mid-flight', async () => {
    const slow = deferred<boolean>();
    const step = vi.fn().mockReturnValue(slow.promise);
    const controller = createSerialPlayback({ step });
    controller.start();
    await vi.advanceTimersByTimeAsync(1000);
    controller.pause();
    slow.resolve(true);
    await wait();
    await vi.advanceTimersByTimeAsync(5000);
    expect(step).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('can resume after pausing', async () => {
    const step = vi.fn().mockResolvedValue(true);
    const controller = createSerialPlayback({ step });
    controller.start();
    await vi.advanceTimersByTimeAsync(1000);
    controller.pause();
    controller.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(step).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('stops when the scenario reaches its end', async () => {
    const step = vi.fn().mockResolvedValue(false);
    const onStop = vi.fn();
    const controller = createSerialPlayback({ step, onStop });
    controller.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(step).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledOnce();
    expect(controller.isRunning()).toBe(false);
    controller.dispose();
  });

  it('stops and reports a rejected advance', async () => {
    const step = vi.fn().mockRejectedValue(new Error('API unreachable'));
    const onError = vi.fn();
    const controller = createSerialPlayback({ step, onError });
    controller.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(step).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledOnce();
    expect(controller.isRunning()).toBe(false);
    controller.dispose();
  });

  it('disposes pending timers', async () => {
    const step = vi.fn().mockResolvedValue(true);
    const controller = createSerialPlayback({ step });
    controller.start();
    controller.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(step).not.toHaveBeenCalled();
    controller.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(step).not.toHaveBeenCalled();
  });

  it('starting twice does not start two loops', async () => {
    const step = vi.fn().mockResolvedValue(true);
    const controller = createSerialPlayback({ step });
    controller.start();
    controller.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(step).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('validates the playback interval', () => {
    const step = vi.fn().mockResolvedValue(true);
    expect(() => createSerialPlayback({ step, delayMs: 0 })).toThrow(RangeError);
    expect(() => createSerialPlayback({ step, delayMs: Infinity })).toThrow(RangeError);
    expect(() => createSerialPlayback({ step, delayMs: 0.5 })).toThrow(RangeError);
  });
});
