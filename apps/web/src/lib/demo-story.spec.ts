import { describe, expect, it } from 'vitest';
import { appendDemoTick, emptyDemoStory, formatModelEta, nextDriverToFocus } from './demo-story';
import type { AdvanceResponse, DriverAlert } from './scene';

const warning: DriverAlert = {
  id: 'al-1', emergencyVehicleId: 'AMB-001', civilianVehicleId: 'CAR-025',
  location: { latitude: 39.68, longitude: -75.75 }, reason: 'CROSSING',
  classification: 'UNVERIFIED_ROUTE_ENCOUNTER', emergencyEtaSeconds: 9.1,
  civilianEtaSeconds: 11, etaDifferenceSeconds: 1.9,
  firstDetectedAtMs: 0, lastUpdatedAtMs: 1000,
};
function response(timeMs: number, ...events: unknown[]): AdvanceResponse {
  return { timeMs, encounterCount: 1, events, snapshot: { timeMs, vehicles: [], alerts: [] } };
}
const event = (type: string, alert: unknown = warning) => ({ type, alert });

describe('12A live demo event narration', () => {
  it('begins empty and cannot fabricate alerts', () => {
    const story = appendDemoTick(emptyDemoStory(), response(1000));
    expect(story.created).toBe(0);
    expect(story.recent).toEqual([]);
  });
  it('records real CREATED and CLEARED events from backend ticks', () => {
    const created = appendDemoTick(emptyDemoStory(), response(1000, event('CREATED')));
    const cleared = appendDemoTick(created, response(2000, event('CLEARED')));
    expect(cleared).toMatchObject({ created: 1, cleared: 1, updated: 0 });
    expect(cleared.recent.map((item) => item.type)).toEqual(['CLEARED', 'CREATED']);
  });
  it('counts updates without flooding the concise event log', () => {
    const created = appendDemoTick(emptyDemoStory(), response(1000, event('CREATED')));
    const updated = appendDemoTick(created, response(2000, event('UPDATED')));
    expect(updated.updated).toBe(1);
    expect(updated.recent).toEqual(created.recent);
  });
  it('tracks distinct warned and completed drivers', () => {
    const first = appendDemoTick(emptyDemoStory(), response(1000, event('CREATED'), event('CLEARED')));
    const next = appendDemoTick(first, response(2000, event('CREATED'), event('CLEARED')));
    expect(next.created).toBe(2);
    expect(next.completedDrivers).toEqual(['CAR-025']);
    expect(next.affectedDrivers).toEqual(['CAR-025']);
  });
  it('does not mutate prior state', () => {
    const prev = appendDemoTick(emptyDemoStory(), response(1000, event('CREATED')));
    appendDemoTick(prev, response(2000, event('CLEARED')));
    expect(prev.cleared).toBe(0);
    expect(prev.recent).toHaveLength(1);
  });
  it('ignores duplicate and older ticks to avoid double counting', () => {
    const first = appendDemoTick(emptyDemoStory(), response(1000, event('CREATED')));
    expect(appendDemoTick(first, response(1000, event('CREATED')))).toBe(first);
    expect(appendDemoTick(first, response(500, event('CREATED')))).toBe(first);
  });
  it('discards malformed events rather than inventing warnings', () => {
    const result = appendDemoTick(emptyDemoStory(), response(1000,
      event('CREATED', null), event('CREATED', { civilianVehicleId: 'WRONG' }),
      { type: 'OTHER', alert: warning }, {}, null));
    expect(result.created).toBe(0);
  });
  it('allows an event with no ETA without assuming a value', () => {
    const next = appendDemoTick(emptyDemoStory(), response(1000, event('CREATED', {
      civilianVehicleId: 'CAR-002', reason: 'NEAR_PATH',
    })));
    expect(next.recent[0].emergencyEtaSeconds).toBeNull();
  });
  it('caps recent events at eight to keep the UI small', () => {
    let state = emptyDemoStory();
    for (let n = 1; n <= 20; n++) state = appendDemoTick(state, response(n * 1000, event('CREATED')));
    expect(state.recent).toHaveLength(8);
    expect(state.created).toBe(20);
  });
  it('does not treat a normal snapshot as an alert event', () => {
    const scene = response(1000);
    scene.snapshot.alerts = [warning];
    expect(appendDemoTick(emptyDemoStory(), scene).created).toBe(0);
  });
  it('autofocuses the first new, still-active warning', () => {
    const prev = emptyDemoStory();
    const next = appendDemoTick(prev, response(1000, event('CREATED')));
    expect(nextDriverToFocus('CAR-001', prev, next, [warning])).toBe('CAR-025');
  });
  it('does not steal focus from a currently warned driver', () => {
    const prev = emptyDemoStory();
    const next = appendDemoTick(prev, response(1000, event('CREATED')));
    expect(nextDriverToFocus('CAR-025', prev, next, [warning])).toBeNull();
  });
  it('does not focus cleared or expired warnings', () => {
    const prev = emptyDemoStory();
    const next = appendDemoTick(prev, response(1000, event('CREATED'), event('CLEARED')));
    expect(nextDriverToFocus('CAR-001', prev, next, [])).toBeNull();
  });
  it('does not refocus on an old warning during unrelated later ticks', () => {
    const prev = appendDemoTick(emptyDemoStory(), response(1000, event('CREATED')));
    const next = appendDemoTick(prev, response(2000));
    expect(nextDriverToFocus('CAR-001', prev, next, [warning])).toBeNull();
  });
  it('returns a fresh empty state for reset or scenario change', () => {
    const active = appendDemoTick(emptyDemoStory(), response(1000, event('CREATED')));
    expect(active.created).toBe(1);
    expect(emptyDemoStory().created).toBe(0);
  });
  it('formats simulation ETA without implying a measured distance', () => {
    expect(formatModelEta(9.1)).toBe('10 s');
    expect(formatModelEta(0)).toBe('0 s');
    expect(formatModelEta(66)).toBe('1m 06s');
    expect(formatModelEta(null)).toBe('—');
    expect(formatModelEta(Number.NaN)).toBe('—');
    expect(formatModelEta(-4)).toBe('—');
  });
});
