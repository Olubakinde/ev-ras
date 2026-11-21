import type { AdvanceResponse, DriverAlert } from './scene';

/** Display-only audit of alert events actually emitted by /demo/advance.
 * Not a validated alert ground truth or a replacement for the 11B replay manifest. */
export type DemoEventType = 'CREATED' | 'UPDATED' | 'CLEARED';

export interface DemoStoryEvent {
  type: DemoEventType;
  driverId: string;
  reason: string;
  timeMs: number;
  emergencyEtaSeconds: number | null;
  civilianEtaSeconds: number | null;
  etaDifferenceSeconds: number | null;
}

export interface DemoStory {
  lastTimeMs: number;
  created: number;
  updated: number;
  cleared: number;
  affectedDrivers: string[];
  completedDrivers: string[];
  recent: DemoStoryEvent[];
}

export function emptyDemoStory(): DemoStory {
  return {
    lastTimeMs: 0, created: 0, updated: 0, cleared: 0,
    affectedDrivers: [], completedDrivers: [], recent: [],
  };
}

function nonnegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseEvent(value: unknown, timeMs: number): DemoStoryEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  if (event.type !== 'CREATED' && event.type !== 'UPDATED' && event.type !== 'CLEARED') return null;
  if (!event.alert || typeof event.alert !== 'object') return null;
  const alert = event.alert as Record<string, unknown>;
  if (typeof alert.civilianVehicleId !== 'string' || !/^CAR-\d{3}$/.test(alert.civilianVehicleId)) return null;
  return {
    type: event.type,
    driverId: alert.civilianVehicleId,
    reason: typeof alert.reason === 'string' ? alert.reason : 'UNKNOWN',
    timeMs,
    emergencyEtaSeconds: nonnegative(alert.emergencyEtaSeconds),
    civilianEtaSeconds: nonnegative(alert.civilianEtaSeconds),
    etaDifferenceSeconds: nonnegative(alert.etaDifferenceSeconds),
  };
}

/** Does not infer events by comparing snapshots. Updates are not put in the
 * concise activity log, preventing 55 UPDATEs from hiding CREATED/CLEARED. */
export function appendDemoTick(previous: DemoStory, response: AdvanceResponse): DemoStory {
  if (!Number.isFinite(response.timeMs) || response.timeMs <= previous.lastTimeMs) return previous;
  const events = (Array.isArray(response.events) ? response.events : [])
    .map((value) => parseEvent(value, response.timeMs))
    .filter((event): event is DemoStoryEvent => event !== null);
  let created = previous.created;
  let updated = previous.updated;
  let cleared = previous.cleared;
  const affected = new Set(previous.affectedDrivers);
  const completed = new Set(previous.completedDrivers);
  let recent = previous.recent;
  for (const event of events) {
    if (event.type === 'CREATED') {
      created++;
      affected.add(event.driverId);
      recent = [event, ...recent].slice(0, 8);
    } else if (event.type === 'UPDATED') {
      updated++;
    } else {
      cleared++;
      completed.add(event.driverId);
      recent = [event, ...recent].slice(0, 8);
    }
  }
  return {
    lastTimeMs: response.timeMs,
    created, updated, cleared,
    affectedDrivers: [...affected].sort(),
    completedDrivers: [...completed].sort(),
    recent,
  };
}

/** Follow the next newly warned driver, but don't pull attention away from
 * a currently warned driver. Only follow actual, still-active warnings. */
export function nextDriverToFocus(
  currentDriverId: string,
  previous: DemoStory,
  next: DemoStory,
  activeAlerts: readonly DriverAlert[],
): string | null {
  const active = new Set(activeAlerts.map((alert) => alert.civilianVehicleId));
  if (active.has(currentDriverId)) return null;
  const created = next.recent.find((event) =>
    event.type === 'CREATED' && event.timeMs > previous.lastTimeMs && active.has(event.driverId),
  );
  return created && created.driverId !== currentDriverId ? created.driverId : null;
}

/** ETA is the backend's predicted encounter time, NOT response time, distance,
 * a guaranteed arrival, or a measured real-world traffic result. */
export function formatModelEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.ceil(seconds)} s`;
  return `${Math.floor(seconds / 60)}m ${String(Math.ceil(seconds % 60)).padStart(2, '0')}s`;
}
