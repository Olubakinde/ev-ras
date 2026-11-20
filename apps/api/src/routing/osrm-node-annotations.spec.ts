import { describe, expect, it } from 'vitest';

import { parseOsrmNodeAnnotations } from './osrm-node-annotations.js';

const geometry = [
  [-75.751, 39.683],
  [-75.7505, 39.683],
  [-75.75, 39.683],
  [-75.749, 39.683],
];

function legs(nodes: unknown): unknown {
  return [{ annotation: { nodes } }];
}

describe('parseOsrmNodeAnnotations', () => {
  it('maps documented interior-only annotations without misaligning endpoints', () => {
    expect(parseOsrmNodeAnnotations(geometry, legs([101, 102]))).toEqual([
      { id: '101', position: { latitude: 39.683, longitude: -75.7505 } },
      { id: '102', position: { latitude: 39.683, longitude: -75.75 } },
    ]);
  });

  it('maps a full-length annotation sequence', () => {
    const nodes = parseOsrmNodeAnnotations(geometry, legs([101, 102, 103, 104]));
    expect(nodes).toHaveLength(4);
    expect(nodes?.[0].position.longitude).toBe(-75.751);
    expect(nodes?.[3].id).toBe('104');
  });

  it('preserves large string node IDs without numeric conversion', () => {
    const nodes = parseOsrmNodeAnnotations(
      geometry,
      legs(['9007199254740993', '9007199254740995']),
    );
    expect(nodes?.[0].id).toBe('9007199254740993');
  });

  it('rejects unsafe numeric node IDs', () => {
    expect(parseOsrmNodeAnnotations(geometry, legs([9007199254740992, 102])))
      .toBeUndefined();
  });

  it('rejects unmatched annotation lengths', () => {
    expect(parseOsrmNodeAnnotations(geometry, legs([101, 102, 103])))
      .toBeUndefined();
  });

  it('rejects zero and invalid OSM node IDs instead of treating them as shared', () => {
    expect(parseOsrmNodeAnnotations(geometry, legs([0, 102]))).toBeUndefined();
    expect(parseOsrmNodeAnnotations(geometry, legs([-1, 102]))).toBeUndefined();
    expect(parseOsrmNodeAnnotations(geometry, legs(['1.5', '2']))).toBeUndefined();
  });

  it('rejects missing or multiple route legs', () => {
    expect(parseOsrmNodeAnnotations(geometry, undefined)).toBeUndefined();
    expect(parseOsrmNodeAnnotations(geometry, [])).toBeUndefined();
    expect(parseOsrmNodeAnnotations(geometry, [
      { annotation: { nodes: [1, 2] } },
      { annotation: { nodes: [3, 4] } },
    ])).toBeUndefined();
  });

  it('rejects invalid node coordinates', () => {
    const bad = [geometry[0], [200, 39.683], geometry[2], geometry[3]];
    expect(parseOsrmNodeAnnotations(bad, legs([1, 2]))).toBeUndefined();
  });

  it('rejects responses with no usable nodes', () => {
    expect(parseOsrmNodeAnnotations(geometry, legs([]))).toBeUndefined();
    expect(parseOsrmNodeAnnotations(geometry, [{}])).toBeUndefined();
  });
});

it('requests OSRM node annotations and exposes them on DrivingRoute', async () => {
  const { OsrmClient } = await import('./osrm-client.js');
  let requestedUrl = '';
  const mockFetch = (async (input: string | URL | Request): Promise<Response> => {
    requestedUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    return new Response(JSON.stringify({
      code: 'Ok',
      routes: [{
        distance: 200,
        duration: 20,
        geometry: { type: 'LineString', coordinates: geometry },
        legs: [{ annotation: { nodes: [501, 502] } }],
      }],
    }), { status: 200 });
  }) as typeof fetch;

  const client = new OsrmClient(mockFetch, 'https://routing.example.test');
  const route = await client.getDrivingRoute(
    { latitude: 39.683, longitude: -75.751 },
    { latitude: 39.683, longitude: -75.749 },
    'AMB-001',
  );

  expect(new URL(requestedUrl).searchParams.get('annotations')).toBe('nodes');
  expect(route.topologyNodes?.map((node) => node.id)).toEqual(['501', '502']);
  expect(route.segmentIds).toHaveLength(3);
});
