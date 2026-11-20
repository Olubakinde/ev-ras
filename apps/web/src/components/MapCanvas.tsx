import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Marker } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { DriverAlert, OperatorSnapshot, Position, RouteMetadata, ScenarioRoute } from '../lib/scene';
import { ROUTE_POINT_DETAILS, type RouteDraft, type RoutePointKey } from '../lib/route-planner';
import { displayRoutes } from '../lib/scene';

// Vite's dependency optimizer rewrites MapLibre's import.meta.url, so the
// library cannot find its tile worker and the map never draws.
if (!maplibregl.getWorkerUrl()) {
  maplibregl.setWorkerUrl(maplibreWorkerUrl);
}

interface Props {
  snapshot: OperatorSnapshot | null;
  metadata: RouteMetadata;
  activeAlert: DriverAlert | null;
  recenterKey: number;
  routeDraft: RouteDraft;
  pickingPoint: RoutePointKey | null;
  onPickLocation: (position: Position) => void;
}

const PRIMARY_STYLE = 'https://tiles.openfreemap.org/styles/positron';

// Development-only fallback. Don't use OSM's public raster tile server for a
// high-traffic deployment; choose a provider or self-host compliant tiles.
const BACKUP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'osm-raster': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      // OSM's public raster endpoint only publishes zooms 0–19. Without this,
      // zooming further requests /20/…png and the whole basemap reports a failure.
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm-base', type: 'raster', source: 'osm-raster' }],
};

const EMPTY_GEOJSON = { type: 'FeatureCollection' as const, features: [] };

function lineFeatures(routes: readonly ScenarioRoute[]) {
  return {
    type: 'FeatureCollection' as const,
    features: routes
      .filter((route) => route.coordinates.length >= 2)
      .map((route) => ({
        type: 'Feature' as const,
        properties: { vehicleId: route.vehicleId },
        geometry: {
          type: 'LineString' as const,
          coordinates: route.coordinates,
        },
      })),
  };
}

function markerElement(id: string, emergency: boolean): HTMLElement {
  const root = document.createElement('div');
  root.className = emergency ? 'vehicle-pin vehicle-pin--emergency' : 'vehicle-pin vehicle-pin--civilian';
  root.setAttribute('aria-label', id);
  root.title = id;

  const inner = document.createElement('span');
  inner.textContent = emergency ? '+' : id.split('-')[1] ?? '•';
  root.appendChild(inner);
  return root;
}

export default function MapCanvas({ snapshot, metadata, activeAlert, recenterKey, routeDraft, pickingPoint, onPickLocation }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const conflictRef = useRef<Marker | null>(null);
  // ROUTE_PLANNER_09B: separate markers from live simulated vehicle markers.
  const routePickMarkersRef = useRef<Map<RoutePointKey, Marker>>(new Map());
  const [mapEpoch, setMapEpoch] = useState(0);
  const [styleEpoch, setStyleEpoch] = useState(0);
  const [mapIssue, setMapIssue] = useState<string | null>(null);
  const [usingBackup, setUsingBackup] = useState(false);
  const routes = useMemo(() => displayRoutes(metadata), [metadata]);

  useEffect(() => {
    if (!containerRef.current) return;
    let map: maplibregl.Map;

    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: PRIMARY_STYLE,
        center: [-75.7502, 39.6832],
        zoom: 14.6,
        attributionControl: { compact: true },
        pitch: 0,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setMapIssue(`MapLibre could not start: ${reason}`);
      return;
    }

    mapRef.current = map;
    setMapEpoch((version) => version + 1);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    // 'load' waits for the first fully rendered map. If a tile fails, it may
    // never fire. 'style.load' lets our GeoJSON layers initialize as soon as
    // the style is parsed, independently of whether basemap tiles load.
    map.on('style.load', () => {
      if (!map.getSource('evras-routes')) {
        map.addSource('evras-routes', { type: 'geojson', data: EMPTY_GEOJSON });
      }
      if (!map.getLayer('evras-route-halo')) {
        map.addLayer({
          id: 'evras-route-halo',
          type: 'line',
          source: 'evras-routes',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.90 },
        });
      }
      if (!map.getLayer('evras-route-lines')) {
        map.addLayer({
          id: 'evras-route-lines',
          type: 'line',
          source: 'evras-routes',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': [
              'match', ['get', 'vehicleId'],
              'AMB-001', '#c4493a',
              'CAR-001', '#2c4246',
              '#9baba9',
            ],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 4.5, 18, 8],
            'line-opacity': 0.92,
          },
        });
      }
      setStyleEpoch((version) => version + 1);
    });

    map.on('error', (event) => {
      const message = event.error instanceof Error ? event.error.message : String(event.error);
      console.error('[EV-RAS MapLibre]', message, event.error);
      // A zoom past the OSM raster cap is overzoom, not a dead basemap.
      if (/tile\.openstreetmap\.org\/(?:[2-9]\d|\d{3})\//.test(message)) return;
      setMapIssue(`Map resource error: ${message}`);
    });

    map.on('webglcontextlost', () => {
      console.error('[EV-RAS MapLibre] WebGL context lost');
      setMapIssue('Browser graphics context was lost. Try reloading the page.');
    });

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();
      conflictRef.current?.remove();
      conflictRef.current = null;
      routePickMarkersRef.current.forEach((marker) => marker.remove());
      routePickMarkersRef.current.clear();
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Picking adds a click listener without modifying MapLibre's rendering pipeline.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapEpoch) return;

    map.getCanvas().style.cursor = pickingPoint ? 'crosshair' : '';
    const selectPoint = (event: maplibregl.MapMouseEvent) => {
      if (!pickingPoint) return;
      onPickLocation({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
    };
    map.on('click', selectPoint);
    return () => {
      map.off('click', selectPoint);
      map.getCanvas().style.cursor = '';
    };
  }, [mapEpoch, pickingPoint, onPickLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapEpoch) return;

    const selected = new Set<RoutePointKey>();
    for (const item of ROUTE_POINT_DETAILS) {
      const position = routeDraft[item.key];
      if (!position) continue;
      selected.add(item.key);
      const existing = routePickMarkersRef.current.get(item.key);
      if (existing) {
        existing.setLngLat([position.longitude, position.latitude]);
      } else {
        const element = document.createElement('div');
        element.className = item.vehicle === 'AMB-001'
          ? 'route-point-marker route-point-marker--emergency'
          : 'route-point-marker';
        element.textContent = item.marker;
        element.title = `${item.vehicle}: ${item.label}`;
        element.setAttribute('aria-label', element.title);
        const marker = new maplibregl.Marker({ element, anchor: 'center' })
          .setLngLat([position.longitude, position.latitude])
          .addTo(map);
        routePickMarkersRef.current.set(item.key, marker);
      }
    }
    for (const [key, marker] of routePickMarkersRef.current) {
      if (!selected.has(key)) {
        marker.remove();
        routePickMarkersRef.current.delete(key);
      }
    }
  }, [mapEpoch, routeDraft]);

  // Show vehicle pins as soon as the map object exists, even if tiles fail.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapEpoch) return;

    const active = new Set<string>();
    for (const vehicle of snapshot?.vehicles ?? []) {
      active.add(vehicle.id);
      let marker = markersRef.current.get(vehicle.id);
      if (!marker) {
        marker = new maplibregl.Marker({
          element: markerElement(vehicle.id, vehicle.kind === 'EMERGENCY'),
          anchor: 'center',
        })
          .setLngLat([vehicle.position.longitude, vehicle.position.latitude])
          .addTo(map);
        markersRef.current.set(vehicle.id, marker);
      } else {
        marker.setLngLat([vehicle.position.longitude, vehicle.position.latitude]);
      }
    }

    for (const [id, marker] of markersRef.current) {
      if (!active.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
  }, [mapEpoch, snapshot]);

  // Add/update line geometry whenever a style (including the backup) loads.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleEpoch) return;

    const source = map.getSource('evras-routes') as GeoJSONSource | undefined;
    source?.setData(lineFeatures(routes));

    if (routes.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      for (const route of routes) {
        for (const coordinate of route.coordinates) bounds.extend(coordinate);
      }
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
          padding: { top: 95, bottom: 145, left: 72, right: 72 },
          maxZoom: 15.6,
          duration: 700,
        });
      }
    }
  }, [styleEpoch, routes, recenterKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapEpoch) return;
    if (!activeAlert) {
      conflictRef.current?.remove();
      conflictRef.current = null;
      return;
    }

    let conflictMarker = conflictRef.current;
    if (!conflictMarker) {
      const element = document.createElement('div');
      element.className = 'conflict-pin';
      element.textContent = '!';
      element.title = 'Potential road encounter';
      conflictMarker = new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat([
          activeAlert.location.longitude,
          activeAlert.location.latitude,
        ])
        .addTo(map);
      conflictRef.current = conflictMarker;
    } else {
      conflictMarker.setLngLat([
        activeAlert.location.longitude,
        activeAlert.location.latitude,
      ]);
    }
  }, [mapEpoch, activeAlert]);

  const selectBasemap = (next: 'light' | 'osm') => {
    const map = mapRef.current;
    if (!map) return;
    const backup = next === 'osm';
    if (backup === usingBackup) return;
    setUsingBackup(backup);
    setMapIssue(null);
    map.setStyle(backup ? BACKUP_STYLE : PRIMARY_STYLE);
  };

  return (
    <>
      <div
        className="map-canvas"
        ref={containerRef}
        role="region"
        aria-label="Interactive Newark route simulation map"
      />
      <div className="map-style-switch" role="group" aria-label="Map type">
        <button type="button" aria-pressed={!usingBackup} onClick={() => selectBasemap('light')}>Light</button>
        <button type="button" aria-pressed={usingBackup} onClick={() => selectBasemap('osm')}>Streets</button>
      </div>
      {mapIssue && (
        <div
          role="alert"
          style={{
            position: 'absolute', top: 168, left: 32, zIndex: 6,
            maxWidth: 360, padding: '13px 16px', borderRadius: 8,
            background: '#ffffff', border: '1px solid #dbc5c0',
            boxShadow: '0 12px 24px rgba(0,0,0,.09)',
            color: '#3a3b39', fontSize: 12, lineHeight: 1.5,
          }}
        >
          <strong style={{ display: 'block', marginBottom: 5 }}>Map tiles failed to load</strong>
          <span>{mapIssue}</span>
          {!usingBackup && (
            <button
              type="button"
              onClick={() => selectBasemap('osm')}
              style={{
                display: 'block', marginTop: 10, padding: '7px 10px',
                background: '#293431', color: '#fff', border: 0, borderRadius: 5,
              }}
            >
              Use backup map tiles
            </button>
          )}
        </div>
      )}
    </>
  );
}
