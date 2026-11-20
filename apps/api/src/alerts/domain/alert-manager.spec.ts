
import { describe, expect, it } from 'vitest';

import type {
  EncounterCandidate,
} from '../../detection/domain/encounter-detector.js';

import {
  createAlertId,
  reconcileAlerts,
} from './alert-manager.js';

const candidate: EncounterCandidate = {
  emergencyVehicleId: 'AMB-001',
  civilianVehicleId: 'CAR-001',
  location: {
    latitude: 39.6837,
    longitude: -75.7497,
  },
  reason: 'CROSSING',
  emergencyEtaSeconds: 12,
  civilianEtaSeconds: 13,
  etaDifferenceSeconds: 1,
};

describe('createAlertId', () => {
  it('creates a stable alert identifier', () => {
    expect(createAlertId('AMB-001', 'CAR-001')).toBe(
      'encounter:AMB-001:CAR-001',
    );
  });

  it('avoids collisions between composite IDs', () => {
    const first = createAlertId('AMB:A', 'CAR');
    const second = createAlertId('AMB', 'A:CAR');

    expect(first).not.toBe(second);
  });

  it('rejects empty vehicle IDs', () => {
    expect(() =>
      createAlertId('', 'CAR-001'),
    ).toThrow();

    expect(() =>
      createAlertId('AMB-001', ' '),
    ).toThrow();
  });
});

describe('reconcileAlerts', () => {
  it('returns empty results when no encounters exist', () => {
    const result = reconcileAlerts([], [], 1000);

    expect(result.active).toEqual([]);
    expect(result.events).toEqual([]);
  });

  it('creates an alert for a new encounter', () => {
    const result = reconcileAlerts(
      [],
      [candidate],
      1000,
    );

    expect(result.active).toHaveLength(1);
    expect(result.events).toHaveLength(1);

    expect(result.events[0].type).toBe('CREATED');

    expect(result.active[0]).toMatchObject({
      emergencyVehicleId: 'AMB-001',
      civilianVehicleId: 'CAR-001',
      classification: 'UNVERIFIED_ROUTE_ENCOUNTER',
      reason: 'CROSSING',
      firstDetectedAtMs: 1000,
      lastUpdatedAtMs: 1000,
    });
  });

  it('does not duplicate unchanged alerts', () => {
    const first = reconcileAlerts(
      [],
      [candidate],
      1000,
    );

    const second = reconcileAlerts(
      first.active,
      [candidate],
      2000,
    );

    expect(second.active).toHaveLength(1);
    expect(second.events).toEqual([]);

    expect(
      second.active[0].firstDetectedAtMs,
    ).toBe(1000);

    expect(
      second.active[0].lastUpdatedAtMs,
    ).toBe(1000);
  });

  it('updates an alert when predicted ETA changes', () => {
    const first = reconcileAlerts(
      [],
      [candidate],
      1000,
    );

    const changed: EncounterCandidate = {
      ...candidate,
      emergencyEtaSeconds: 8,
      civilianEtaSeconds: 9,
    };

    const result = reconcileAlerts(
      first.active,
      [changed],
      2000,
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('UPDATED');

    expect(
      result.active[0].emergencyEtaSeconds,
    ).toBe(8);

    expect(
      result.active[0].firstDetectedAtMs,
    ).toBe(1000);

    expect(
      result.active[0].lastUpdatedAtMs,
    ).toBe(2000);
  });

  it('updates an alert when its location changes', () => {
    const first = reconcileAlerts(
      [],
      [candidate],
      1000,
    );

    const changed: EncounterCandidate = {
      ...candidate,
      location: {
        latitude: 39.684,
        longitude: -75.749,
      },
    };

    const result = reconcileAlerts(
      first.active,
      [changed],
      2000,
    );

    expect(result.events[0].type).toBe('UPDATED');

    expect(
      result.active[0].location.latitude,
    ).toBe(39.684);
  });

  it('clears alerts when encounters disappear', () => {
    const first = reconcileAlerts(
      [],
      [candidate],
      1000,
    );

    const result = reconcileAlerts(
      first.active,
      [],
      2000,
    );

    expect(result.active).toEqual([]);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('CLEARED');

    expect(
      result.events[0].alert.lastUpdatedAtMs,
    ).toBe(2000);
  });

  it('preserves independent alerts for multiple drivers', () => {
    const secondDriver: EncounterCandidate = {
      ...candidate,
      civilianVehicleId: 'CAR-002',
    };

    const result = reconcileAlerts(
      [],
      [candidate, secondDriver],
      1000,
    );

    expect(result.active).toHaveLength(2);

    expect(
      new Set(result.active.map((a) => a.id)).size,
    ).toBe(2);

    expect(
      result.events.every((event) =>
        event.type === 'CREATED',
      ),
    ).toBe(true);
  });

  it('supports multiple emergency vehicles', () => {
    const secondAmbulance: EncounterCandidate = {
      ...candidate,
      emergencyVehicleId: 'AMB-002',
    };

    const result = reconcileAlerts(
      [],
      [candidate, secondAmbulance],
      1000,
    );

    expect(result.active).toHaveLength(2);

    expect(
      result.active[0].id,
    ).not.toBe(result.active[1].id);
  });

  it('only clears the driver whose encounter ended', () => {
    const secondDriver: EncounterCandidate = {
      ...candidate,
      civilianVehicleId: 'CAR-002',
    };

    const first = reconcileAlerts(
      [],
      [candidate, secondDriver],
      1000,
    );

    const result = reconcileAlerts(
      first.active,
      [secondDriver],
      2000,
    );

    expect(result.active).toHaveLength(1);

    expect(
      result.active[0].civilianVehicleId,
    ).toBe('CAR-002');

    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('CLEARED');

    expect(
      result.events[0].alert.civilianVehicleId,
    ).toBe('CAR-001');
  });

  it('creates a new alert when an encounter returns', () => {
    const first = reconcileAlerts(
      [],
      [candidate],
      1000,
    );

    const cleared = reconcileAlerts(
      first.active,
      [],
      2000,
    );

    const returned = reconcileAlerts(
      cleared.active,
      [candidate],
      3000,
    );

    expect(returned.events[0].type).toBe('CREATED');

    expect(
      returned.active[0].firstDetectedAtMs,
    ).toBe(3000);
  });

  it('returns deterministic ordering', () => {
    const other: EncounterCandidate = {
      ...candidate,
      civilianVehicleId: 'CAR-000',
    };

    const result = reconcileAlerts(
      [],
      [candidate, other],
      1000,
    );

    expect(
      result.active.map((alert) =>
        alert.civilianVehicleId,
      ),
    ).toEqual(['CAR-000', 'CAR-001']);
  });

  it('does not mutate the previous alert state', () => {
    const first = reconcileAlerts(
      [],
      [candidate],
      1000,
    );

    const before = structuredClone(first.active);

    reconcileAlerts(
      first.active,
      [
        {
          ...candidate,
          emergencyEtaSeconds: 5,
        },
      ],
      2000,
    );

    expect(first.active).toEqual(before);
  });

  it('rejects duplicate encounter candidates', () => {
    expect(() =>
      reconcileAlerts(
        [],
        [candidate, candidate],
        1000,
      ),
    ).toThrow(/Duplicate encounter candidate/);
  });

  it('rejects duplicate existing alerts', () => {
    const first = reconcileAlerts(
      [],
      [candidate],
      1000,
    );

    expect(() =>
      reconcileAlerts(
        [first.active[0], first.active[0]],
        [],
        2000,
      ),
    ).toThrow(/Duplicate existing alert/);
  });

  it('rejects invalid simulation timestamps', () => {
    expect(() =>
      reconcileAlerts([], [candidate], -1),
    ).toThrow(RangeError);

    expect(() =>
      reconcileAlerts([], [candidate], NaN),
    ).toThrow(RangeError);
  });

  it('rejects time moving backwards', () => {
    const first = reconcileAlerts(
      [],
      [candidate],
      2000,
    );

    expect(() =>
      reconcileAlerts(
        first.active,
        [candidate],
        1000,
      ),
    ).toThrow(RangeError);
  });

  it('rejects invalid encounter ETAs', () => {
    expect(() =>
      reconcileAlerts(
        [],
        [{
          ...candidate,
          emergencyEtaSeconds: Infinity,
        }],
        1000,
      ),
    ).toThrow(RangeError);

    expect(() =>
      reconcileAlerts(
        [],
        [{
          ...candidate,
          civilianEtaSeconds: -1,
        }],
        1000,
      ),
    ).toThrow(RangeError);
  });

  it('rejects inconsistent stationary vehicle ETAs', () => {
    expect(() =>
      reconcileAlerts(
        [],
        [{
          ...candidate,
          civilianEtaSeconds: null,
          etaDifferenceSeconds: 1,
        }],
        1000,
      ),
    ).toThrow(/Inconsistent/);
  });

  it('accepts stationary driver encounter candidates', () => {
    const stationary: EncounterCandidate = {
      ...candidate,
      reason: 'STATIONARY_ON_PATH',
      civilianEtaSeconds: null,
      etaDifferenceSeconds: null,
    };

    const result = reconcileAlerts(
      [],
      [stationary],
      1000,
    );

    expect(result.active).toHaveLength(1);

    expect(
      result.active[0].civilianEtaSeconds,
    ).toBeNull();
  });

  it('rejects invalid encounter coordinates', () => {
    expect(() =>
      reconcileAlerts(
        [],
        [{
          ...candidate,
          location: {
            latitude: 120,
            longitude: -75,
          },
        }],
        1000,
      ),
    ).toThrow(RangeError);
  });
});
