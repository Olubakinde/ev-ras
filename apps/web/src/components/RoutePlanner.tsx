import { ArrowRight, Check, MapPin, RotateCcw, X } from 'lucide-react';
import {
  draftValidationMessage,
  formatPoint,
  ROUTE_POINT_DETAILS,
  selectedPointCount,
  type RouteDraft,
  type RoutePointKey,
} from '../lib/route-planner';
import '../route-planner.css';

interface Props {
  draft: RouteDraft;
  selecting: RoutePointKey | null;
  busy: boolean;
  onSelect: (point: RoutePointKey) => void;
  onClear: () => void;
  onGenerate: () => void;
  onClose: () => void;
}

export default function RoutePlanner({ draft, selecting, busy, onSelect, onClear, onGenerate, onClose }: Props) {
  const completed = selectedPointCount(draft);
  const problem = draftValidationMessage(draft);

  return (
    <section className="route-planner" aria-label="Plan custom routes">
      <div className="route-planner__heading">
        <div>
          <span className="route-planner__eyebrow">Custom scenario</span>
          <h3>Plan routes</h3>
        </div>
        <button type="button" className="route-planner__icon" onClick={onClose} aria-label="Close route planner"><X size={18}/></button>
      </div>
      <p className="route-planner__description">
        Select four locations on the map. We'll calculate real driving routes and start a new simulation.
      </p>
      <div className="route-planner__progress" aria-label={`${completed} of 4 points selected`}>
        {ROUTE_POINT_DETAILS.map((item) => (
          <span key={item.key} className={draft[item.key] ? 'is-complete' : selecting === item.key ? 'is-current' : ''} />
        ))}
      </div>
      <div className="route-planner__group">
        <div className="route-planner__group-title"><span className="route-planner__vehicle-dot route-planner__vehicle-dot--emergency"/> Ambulance <small>AMB-001</small></div>
        {ROUTE_POINT_DETAILS.filter((point) => point.vehicle === 'AMB-001').map((point) => (
          <button key={point.key} type="button" className={`route-planner__point ${selecting === point.key ? 'is-selecting' : ''}`} onClick={() => onSelect(point.key)} disabled={busy} aria-pressed={selecting === point.key}>
            <span className="route-planner__marker route-planner__marker--emergency">{point.marker}</span>
            <span className="route-planner__point-copy"><strong>{point.label}</strong><small>{formatPoint(draft[point.key])}</small></span>
            {draft[point.key] ? <Check size={16} /> : <MapPin size={16} />}
          </button>
        ))}
      </div>
      <div className="route-planner__group">
        <div className="route-planner__group-title"><span className="route-planner__vehicle-dot"/> Civilian driver <small>CAR-001</small></div>
        {ROUTE_POINT_DETAILS.filter((point) => point.vehicle === 'CAR-001').map((point) => (
          <button key={point.key} type="button" className={`route-planner__point ${selecting === point.key ? 'is-selecting' : ''}`} onClick={() => onSelect(point.key)} disabled={busy} aria-pressed={selecting === point.key}>
            <span className="route-planner__marker">{point.marker}</span>
            <span className="route-planner__point-copy"><strong>{point.label}</strong><small>{formatPoint(draft[point.key])}</small></span>
            {draft[point.key] ? <Check size={16} /> : <MapPin size={16} />}
          </button>
        ))}
      </div>
      <p className="route-planner__hint" aria-live="polite">
        {selecting ? 'Click anywhere on the map to place the selected point.' : problem ?? 'All points selected. Ready to calculate routes.'}
      </p>
      <div className="route-planner__actions">
        <button type="button" className="route-planner__clear" onClick={onClear} disabled={busy || completed === 0}><RotateCcw size={15}/> Clear</button>
        <button type="button" className="route-planner__generate" onClick={onGenerate} disabled={busy || problem !== null}>
          {busy ? 'Routing…' : 'Generate routes'} <ArrowRight size={16}/>
        </button>
      </div>
      <div className="route-planner__disclaimer">Simulated vehicles · Constant-speed assumptions · Not for road use</div>
    </section>
  );
}
