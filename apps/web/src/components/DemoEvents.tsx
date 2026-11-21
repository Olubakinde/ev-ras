import { AlertTriangle, ChevronDown, ChevronUp, CircleCheck, Focus, ListFilter } from 'lucide-react';
import type { DriverAlert, OperatorSnapshot } from '../lib/scene';
import { alertTitle, formatSimTime } from '../lib/scene';
import { driverDisplayName } from '../lib/traffic-view';
import { formatModelEta, type DemoStory } from '../lib/demo-story';
import '../demo-events.css';

interface Props {
  snapshot: OperatorSnapshot | null;
  story: DemoStory;
  seed: number | null;
  driverId: string;
  followAlerts: boolean;
  onToggleFollow: () => void;
  onSelectDriver: (id: string) => void;
}

/** Operator-only event story. All counts come from real backend advance events. */
export default function DemoEvents({
  snapshot, story, seed, driverId, followAlerts, onToggleFollow, onSelectDriver,
}: Props) {
  const active = snapshot?.alerts ?? [];
  const selectedAlert: DriverAlert | undefined = active.find((alert) => alert.civilianVehicleId === driverId);
  const recent = story.recent.slice(0, 5);

  return (
    <section className="demo-events" aria-label="Live simulation warning activity">
      <header className="demo-events__head">
        <span className="demo-events__eyebrow"><ListFilter size={13} aria-hidden="true" /> SIMULATION EVENTS</span>
        <span className="demo-events__seed">Seed {seed ?? '—'}</span>
      </header>
      <div className="demo-events__stats" aria-label="Observed warning event counts">
        <div><strong>{story.created}</strong><span>Created</span></div>
        <div><strong>{story.cleared}</strong><span>Cleared</span></div>
        <div><strong>{active.length}</strong><span>Active now</span></div>
      </div>
      <div className="demo-events__follow-row">
        <span><Focus size={13} aria-hidden="true" /> Follow new warnings</span>
        <button
          className="demo-events__follow-button"
          type="button"
          aria-pressed={followAlerts}
          onClick={onToggleFollow}
        >{followAlerts ? 'On' : 'Off'}</button>
      </div>
      <div className={`demo-events__selected ${selectedAlert ? 'demo-events__selected--warning' : ''}`}>
        <div className="demo-events__selected-label">
          {selectedAlert ? <AlertTriangle size={14} aria-hidden="true" /> : <CircleCheck size={14} aria-hidden="true" />}
          {driverDisplayName(driverId)}
        </div>
        <strong>{selectedAlert ? alertTitle(selectedAlert.reason) : 'No current warning'}</strong>
        {selectedAlert ? (
          <>
            <div className="demo-events__eta" aria-label="Predicted encounter timing">
              <span>Ambulance <b>{formatModelEta(selectedAlert.emergencyEtaSeconds)}</b></span>
              <span>Driver <b>{formatModelEta(selectedAlert.civilianEtaSeconds)}</b></span>
            </div>
            <p>Predicted time to a modeled route encounter. Not an arrival guarantee.</p>
          </>
        ) : (
          <p>{active.length ? `${active.length} other driver(s) currently warned.` : 'Waiting for a qualifying road encounter.'}</p>
        )}
      </div>
      <div className="demo-events__timeline-label">
        <strong>Recent transitions</strong>
        <span>Updates: {story.updated}</span>
      </div>
      <div className="demo-events__timeline" aria-label="Recent warning creations and clearances">
        {recent.length === 0 ? (
          <p className="demo-events__empty">Press Play to observe real warning events from the simulation.</p>
        ) : recent.map((event, index) => (
          <button
            type="button"
            key={`${event.timeMs}-${event.type}-${event.driverId}-${index}`}
            className={`demo-events__event ${event.driverId === driverId ? 'demo-events__event--selected' : ''}`}
            onClick={() => onSelectDriver(event.driverId)}
            aria-label={`Select ${driverDisplayName(event.driverId)}: ${event.type.toLowerCase()} at ${formatSimTime(event.timeMs)}`}
          >
            <span className={`demo-events__event-marker ${event.type === 'CREATED' ? 'demo-events__event-marker--warning' : ''}`} aria-hidden="true" />
            <span className="demo-events__event-copy">
              <strong>{driverDisplayName(event.driverId)} · {event.type === 'CREATED' ? 'Warned' : 'Cleared'}</strong>
              <small>{event.type === 'CREATED' ? alertTitle(event.reason) : 'Warning ended'}</small>
            </span>
            <time>{formatSimTime(event.timeMs)}</time>
          </button>
        ))}
      </div>
      <footer className="demo-events__foot">
        <span>Events observed in this browser session</span>
        {active.length > 0 ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
      </footer>
    </section>
  );
}
