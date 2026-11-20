import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Ambulance, ArrowUpRight, CarFront, Check, CircleHelp, Crosshair,
  LoaderCircle, MapPin, Pause, Play, RotateCcw, ShieldAlert, Signal,
  SkipForward, WifiOff,
} from 'lucide-react';
import { io, type Socket } from 'socket.io-client';
import MapCanvas from './components/MapCanvas';
import { api } from './lib/api';
import {
  alertTitle, formatDistance, formatSimTime, getPrimaryDriverAlert,
  NEWARK_SCENARIO, vehicleLabel,
  type OperatorSnapshot, type RouteMetadata,
} from './lib/scene';

type Connection = 'connecting' | 'connected' | 'disconnected';

const INITIAL_METADATA: RouteMetadata = { source: 'DEMO', routes: [] };
const ICON = 16;
const STROKE = 1.75;

function displayLabel(value: string): string {
  const text = value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\bosm\b/g, 'OSM')
    .replace(/\bosrm\b/g, 'OSRM');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="7" />
      <path d="M8.25 19.25V11.25H19.25" />
      <circle className="brand-mark-origin" cx="8.25" cy="19.25" r="1.65" />
      <circle className="brand-mark-ahead" cx="19.25" cy="11.25" r="2.05" />
    </svg>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState<OperatorSnapshot | null>(null);
  const [metadata, setMetadata] = useState<RouteMetadata>(INITIAL_METADATA);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recenterKey, setRecenterKey] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const actionInProgress = useRef(false);

  const refreshState = useCallback(async () => {
    try {
      const next = await api.state();
      setSnapshot(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not refresh simulation state.');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let socket: Socket | null = null;

    async function connect() {
      try {
        const [state, routes, session] = await Promise.all([
          api.state(), api.routes(), api.session(),
        ]);
        if (cancelled) return;
        setSnapshot(state);
        setMetadata(routes);
        setError(null);
        setLoading(false);

        socket = io('/drivers', {
          path: '/socket.io',
          auth: { token: session.token },
          transports: ['websocket'],
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
        });
        socketRef.current = socket;
        socket.on('connect', () => setConnection('connected'));
        socket.on('disconnect', () => setConnection('disconnected'));
        socket.on('connect_error', (reason: Error) => {
          setConnection('disconnected');
          if (reason.message.includes('Unauthorized')) {
            setError('Driver session expired. Reload the page to reconnect.');
          }
        });
        socket.on('simulation:snapshot', () => void refreshState());
        socket.on('simulation:tick', () => void refreshState());
        socket.on('simulation:reset', () => void refreshState());
        socket.on('simulation:unavailable', () => void refreshState());
        socket.on('alert:created', () => void refreshState());
        socket.on('alert:updated', () => void refreshState());
        socket.on('alert:cleared', () => void refreshState());
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'Failed to initialize EV-RAS.');
        setLoading(false);
        setConnection('disconnected');
      }
    }

    void connect();
    return () => {
      cancelled = true;
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [refreshState]);

  const step = useCallback(async (deltaMs = 1000) => {
    if (actionInProgress.current) return;
    actionInProgress.current = true;
    setBusy(true);
    try {
      const next = await api.step(deltaMs);
      setSnapshot(next.snapshot);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not advance simulation.');
      setPlaying(false);
    } finally {
      actionInProgress.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => void step(1000), 1000);
    return () => window.clearInterval(timer);
  }, [playing, step]);

  const reset = useCallback(async () => {
    if (actionInProgress.current) return;
    setPlaying(false);
    actionInProgress.current = true;
    setBusy(true);
    try {
      setSnapshot(await api.reset());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reset scenario.');
    } finally {
      actionInProgress.current = false;
      setBusy(false);
    }
  }, []);

  const loadNewark = useCallback(async () => {
    if (actionInProgress.current) return;
    setPlaying(false);
    actionInProgress.current = true;
    setBusy(true);
    try {
      const next = await api.loadScenario(NEWARK_SCENARIO);
      setSnapshot(next.snapshot);
      setMetadata({ source: next.source, routes: next.routes, topologyStatus: next.topologyStatus });
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load Newark routes.');
    } finally {
      actionInProgress.current = false;
      setBusy(false);
    }
  }, []);

  const activeAlert = getPrimaryDriverAlert(snapshot);
  const liveVehicles = snapshot?.vehicles ?? [];
  const isRealRoads = metadata.source === 'OSRM';
  const primaryDistance = metadata.routes.find((route) => route.vehicleId === 'AMB-001')?.distanceMeters ?? 0;
  const finished = liveVehicles.length > 0 && liveVehicles.every((vehicle) => vehicle.finished);

  useEffect(() => {
    if (finished) setPlaying(false);
  }, [finished]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <header className="brand-row">
          <BrandMark />
          <div className="brand-text">
            <strong>EV-RAS</strong>
            <span>Route awareness</span>
          </div>
          <span className="brand-version">0.1</span>
        </header>

        <div className="sidebar-content">
          <div className="section-index"><span className="index-dot" /> Simulation</div>
          <h1>Live monitoring</h1>
          <p className="sidebar-intro">Emergency vehicle movement and possible route encounters.</p>

          <div className="connection-strip">
            <div className={`connection-indicator connection-indicator--${connection}`} />
            <span>{connection === 'connected' ? 'Driver feed connected' : connection === 'connecting' ? 'Connecting to driver feed' : 'Driver feed disconnected'}</span>
            {connection === 'connected'
              ? <Signal size={ICON} strokeWidth={STROKE} />
              : <WifiOff size={ICON} strokeWidth={STROKE} />}
          </div>

          <div className="section-heading"><span>Scenario</span></div>
          <div className="scenario-card">
            <div className="scenario-card-top">
              <span className="tiny-label">Location</span>
              <span className="scenario-pin"><MapPin size={14} strokeWidth={STROKE} /></span>
            </div>
            <strong>Newark, Delaware</strong>
            <span className="scenario-subtitle">{isRealRoads ? 'OpenStreetMap road network' : 'Illustrative intersection demo'}</span>
            <div className="scenario-card-divider" />
            <div className="scenario-stat-row"><span>Route source</span><b>{isRealRoads ? 'OSRM' : 'Controlled demo'}</b></div>
            <div className="scenario-stat-row"><span>Road evidence</span><b>{isRealRoads ? displayLabel(metadata.topologyStatus ?? 'Not reported') : 'Demo only'}</b></div>
            <button className="load-route" type="button" onClick={() => void loadNewark()} disabled={loading || busy}>
              <span>{busy ? 'Working...' : isRealRoads ? 'Reload Newark routes' : 'Load real Newark routes'}</span>
              {busy ? <LoaderCircle size={ICON} className="spin" /> : <ArrowUpRight size={ICON} strokeWidth={STROKE} />}
            </button>
          </div>

          <div className="section-heading section-heading--vehicles">
            <span>Vehicles</span>
            <span className="section-count">{liveVehicles.length}</span>
          </div>
          <div className="vehicle-list">
            {liveVehicles.map((vehicle) => (
              <div className="vehicle-entry" key={vehicle.id}>
                <div className={`vehicle-icon ${vehicle.kind === 'EMERGENCY' ? 'vehicle-icon--emergency' : ''}`}>
                  {vehicle.kind === 'EMERGENCY'
                    ? <Ambulance size={ICON} strokeWidth={STROKE} />
                    : <CarFront size={ICON} strokeWidth={STROKE} />}
                </div>
                <div className="vehicle-desc">
                  <strong>{vehicleLabel(vehicle.id)}</strong>
                  <span>{vehicle.id} <span className="mid-dot">·</span> {vehicle.finished ? 'Arrived' : 'En route'}</span>
                </div>
                <span className="vehicle-speed">
                  {Math.round(vehicle.speedMps * 3.6)}
                  <small>km/h</small>
                </span>
              </div>
            ))}
            {loading && <div className="loading-line"><LoaderCircle className="spin" size={14} /> Loading vehicles...</div>}
          </div>

          <div className="sidebar-bottom">
            <div className={`advisory ${activeAlert ? 'advisory--active' : ''}`}>
              <div className="advisory-heading">
                <span className="advisory-signal"><ShieldAlert size={ICON} strokeWidth={STROKE} /></span>
                <span>{activeAlert ? 'Potential encounter' : 'Monitoring'}</span>
              </div>
              <strong>{activeAlert ? alertTitle(activeAlert.reason) : 'Monitoring route activity'}</strong>
              <p>{activeAlert ? `Emergency vehicle ETA ${activeAlert.emergencyEtaSeconds.toFixed(1)} seconds. Route conflict is unverified.` : 'No qualifying route encounter in the current simulation state.'}</p>
              <div className="advisory-bottom">
                <span>{activeAlert ? 'Simulated warning' : 'Simulation active'}</span>
                {activeAlert ? <ArrowUpRight size={14} strokeWidth={STROKE} /> : <Check size={14} strokeWidth={STROKE} />}
              </div>
            </div>
            <div className="sidebar-footnote">
              <CircleHelp size={14} strokeWidth={STROKE} />
              <span>Demonstration only. Not for emergency or road use.</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="map-stage">
        <MapCanvas snapshot={snapshot} metadata={metadata} activeAlert={activeAlert} recenterKey={recenterKey} />
        <div className="map-topline">
          <div className="map-title-group">
            <span className="map-overline">EV-RAS</span>
            <h2>Live route simulation <span className="map-title-divider">·</span> Newark</h2>
          </div>
          <div className="top-status">
            <span className="status-dot" />
            <span>{isRealRoads ? 'OSRM routes' : 'Demo network'}</span>
          </div>
        </div>
        <div className="map-tools">
          <button className="map-tool" title="Fit routes to viewport" type="button" onClick={() => setRecenterKey((n) => n + 1)}>
            <Crosshair size={ICON} strokeWidth={STROKE} />
          </button>
        </div>
        <div className="map-label">
          <span className="map-label-dot" />
          Newark, Delaware
          <span className="map-coordinates">39.683° N, 75.750° W</span>
        </div>

        {error && (
          <div className="error-banner">
            <ShieldAlert size={ICON} strokeWidth={STROKE} />
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button>
          </div>
        )}

        <div className="map-bottom-area">
          <div className="map-legend">
            <span className="legend-item"><i className="legend-line legend-line--emergency" /> Emergency route</span>
            <span className="legend-item"><i className="legend-line legend-line--civilian" /> Civilian route</span>
            <span className="legend-source">{isRealRoads ? 'Routed geometry' : 'Illustrative geometry'}</span>
          </div>
          <div className="playback-bar">
            <div className="playback-time">
              <span className="playback-eyebrow">Time</span>
              <strong>{formatSimTime(snapshot?.timeMs ?? 0)}</strong>
            </div>
            <div className="playback-separator" />
            <div className="playback-controls">
              <button type="button" className="control-small" title="Reset simulation" onClick={() => void reset()} disabled={loading || busy}>
                <RotateCcw size={ICON} strokeWidth={STROKE} />
              </button>
              <button type="button" className="control-main" onClick={() => setPlaying((v) => !v)} disabled={loading || (finished && !playing)}>
                {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
                <span>{playing ? 'Pause' : 'Play'}</span>
              </button>
              <button type="button" className="control-small" title="Advance one simulated second" onClick={() => void step(1000)} disabled={loading || busy || playing}>
                <SkipForward size={ICON} strokeWidth={STROKE} />
              </button>
            </div>
            <div className="playback-separator playback-separator--second" />
            <div className="playback-context">
              <span>1.0× speed</span>
              <strong>{isRealRoads ? `${formatDistance(primaryDistance)} routed` : 'Intersection demo'}</strong>
            </div>
          </div>
          <div className="map-footer">
            <span>Experimental</span>
            <span>© OpenStreetMap contributors · OpenFreeMap</span>
            <span>EV-RAS 0.1</span>
          </div>
        </div>
      </main>
    </div>
  );
}
