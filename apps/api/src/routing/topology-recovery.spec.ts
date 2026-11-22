import { describe, expect, it } from 'vitest';
import { createRoadEvidenceGate } from '../detection/domain/road-evidence-gate.js';
import { OsrmClient } from './osrm-client.js';
import { recoverMatchingNodeAnnotations } from './topology-recovery.js';

const coordinates = [
  [-75.751, 39.683],
  [-75.7505, 39.683],
  [-75.75, 39.683],
  [-75.7495, 39.683],
] as const;
const start = { latitude: 39.683, longitude: -75.751 };
const end = { latitude: 39.683, longitude: -75.7495 };

function response(
  points: readonly (readonly number[])[] = coordinates,
  nodes?: readonly (string | number)[],
): unknown {
  return {
    code: 'Ok',
    routes: [{
      distance: 200,
      duration: 18,
      geometry: { type: 'LineString', coordinates: points },
      ...(nodes ? { legs: [{ annotation: { nodes } }] } : {}),
    }],
  };
}

function clientFor(replies: readonly unknown[], enabled = true) {
  const urls: string[] = [];
  let index = 0;
  const request = (async (input: string | URL | Request): Promise<Response> => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const reply = replies[index++];
    if (reply instanceof Error) throw reply;
    if (reply === undefined) throw new Error('Unexpected extra OSRM request');
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;
  return {
    client: new OsrmClient(request, 'https://routing.example.test', enabled),
    urls,
  };
}

describe('recoverMatchingNodeAnnotations', () => {
  it('recovers documented interior node IDs from identical raw coordinates', () => {
    const recovered = recoverMatchingNodeAnnotations(coordinates, response(coordinates, [101, 102]));
    expect(recovered).toEqual([
      { id: '101', position: { latitude: 39.683, longitude: -75.7505 } },
      { id: '102', position: { latitude: 39.683, longitude: -75.75 } },
    ]);
  });

  it('preserves large OSM IDs supplied as strings', () => {
    expect(recoverMatchingNodeAnnotations(
      coordinates, response(coordinates, ['9007199254740993', '9007199254740995']),
    )?.[0].id).toBe('9007199254740993');
  });

  it('refuses one changed coordinate even with valid node IDs', () => {
    const different = coordinates.map((point) => [...point]);
    different[2][0] += 0.000001;
    expect(recoverMatchingNodeAnnotations(coordinates, response(different, [101, 102]))).toBeUndefined();
  });

  it('refuses reversed vertices and changed vertex count', () => {
    expect(recoverMatchingNodeAnnotations(coordinates, response([...coordinates].reverse(), [101, 102])))
      .toBeUndefined();
    expect(recoverMatchingNodeAnnotations(coordinates, response(coordinates.slice(1), [101])))
      .toBeUndefined();
  });

  it('refuses invalid or ambiguous node alignment', () => {
    expect(recoverMatchingNodeAnnotations(coordinates, response(coordinates, [101, 102, 103])))
      .toBeUndefined();
    expect(recoverMatchingNodeAnnotations(coordinates, response(coordinates, [0, 102])))
      .toBeUndefined();
    expect(recoverMatchingNodeAnnotations(coordinates, response(coordinates, [9007199254740992, 102])))
      .toBeUndefined();
  });

  it('refuses an invalid provider response', () => {
    expect(recoverMatchingNodeAnnotations(coordinates, { code: 'NoRoute', routes: [] }))
      .toBeUndefined();
    expect(recoverMatchingNodeAnnotations(coordinates, { code: 'Ok', routes: [] }))
      .toBeUndefined();
    expect(recoverMatchingNodeAnnotations(null, response(coordinates, [101, 102])))
      .toBeUndefined();
  });
});

describe('OSRM topology evidence retry', () => {
  it('recovers an unannotated route with one verified provider retry', async () => {
    const { client, urls } = clientFor([
      response(),
      response(coordinates, [101, 102]),
    ]);
    const result = await client.getDrivingRoute(start, end, 'AMB-001');
    expect(result.topologyNodes?.map((node) => node.id)).toEqual(['101', '102']);
    expect(result.segmentIds).toEqual(['AMB-001:0', 'AMB-001:1', 'AMB-001:2']);
    expect(urls).toHaveLength(2);
    expect(new URL(urls[0]).searchParams.get('annotations')).toBe('nodes');
    expect(new URL(urls[1]).searchParams.get('steps')).toBe('true');
  });

  it('does not retry when original OSM annotations are complete', async () => {
    const { client, urls } = clientFor([response(coordinates, [101, 102])]);
    const result = await client.getDrivingRoute(start, end);
    expect(result.topologyNodes).toHaveLength(2);
    expect(urls).toHaveLength(1);
  });

  it('preserves old single-request default for existing callers', async () => {
    const { client, urls } = clientFor([response()], false);
    const result = await client.getDrivingRoute(start, end);
    expect(result.topologyNodes).toBeUndefined();
    expect(urls).toHaveLength(1);
  });

  it('does not accept recovered nodes when OSRM changes the route', async () => {
    const changed = coordinates.map((point) => [...point]);
    changed[1][1] += 0.00001;
    const { client, urls } = clientFor([response(), response(changed, [101, 102])]);
    const result = await client.getDrivingRoute(start, end);
    expect(result.topologyNodes).toBeUndefined();
    expect(urls).toHaveLength(2);
  });

  it('fails closed after an unsuccessful retry', async () => {
    const { client, urls } = clientFor([response(), new Error('provider down')]);
    const result = await client.getDrivingRoute(start, end);
    expect(result.topologyNodes).toBeUndefined();
    expect(result.segmentIds).toHaveLength(3);
    expect(urls).toHaveLength(2);
  });

  it('does not retry when raw route geometry was deduplicated', async () => {
    const duplicate = [coordinates[0], coordinates[0], coordinates[1], coordinates[2]];
    const { client, urls } = clientFor([response(duplicate)]);
    const result = await client.getDrivingRoute(start, end);
    expect(result.segmentIds).toHaveLength(2);
    expect(result.topologyNodes).toBeUndefined();
    expect(urls).toHaveLength(1);
  });

  it('never makes geometric crossings into road connectivity without shared node IDs', () => {
    const shared = { latitude: 39.683, longitude: -75.75 };
    const gate = createRoadEvidenceGate([
      { vehicleId: 'AMB-001', nodes: [{ id: '101', position: shared }] },
      { vehicleId: 'CAR-001', nodes: [{ id: '999', position: shared }] },
    ]);
    expect(gate({
      emergencyVehicleId: 'AMB-001', civilianVehicleId: 'CAR-001',
      reason: 'CROSSING', location: shared,
      emergencyEtaSeconds: 8, civilianEtaSeconds: 8, etaDifferenceSeconds: 0,
    })).toBe(false);
  });
});
