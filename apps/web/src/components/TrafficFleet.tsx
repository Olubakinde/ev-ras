import { AlertTriangle, CarFront, CheckCircle2 } from 'lucide-react';
import type { OperatorSnapshot } from '../lib/scene';
import {
  civilians,
  driverDisplayName,
  getDriverAlert,
  trafficSummary,
} from '../lib/traffic-view';
import '../traffic-fleet.css';

interface Props {
  snapshot: OperatorSnapshot | null;
  selectedDriverId: string;
  onSelectDriver: (id: string) => void;
  disabled: boolean;
}

/** Operator-only selection, not an authenticated real driver's device. */
export default function TrafficFleet({ snapshot, selectedDriverId, onSelectDriver, disabled }: Props) {
  const cars = civilians(snapshot);
  const summary = trafficSummary(snapshot);

  return (
    <section className="traffic-fleet" aria-label="Simulated civilian traffic">
      <header className="traffic-fleet__header">
        <div>
          <strong>Traffic fleet</strong>
          <span>Simulated Newark traffic</span>
        </div>
        <span className="traffic-fleet__count">{summary.total} cars</span>
      </header>

      <div className="traffic-fleet__summary" aria-label="Traffic status counts">
        <span><i className="traffic-fleet__dot traffic-fleet__dot--moving" />{summary.moving} moving</span>
        <span>{summary.stopped} stopped</span>
        {summary.warned > 0 && <span className="traffic-fleet__warning">{summary.warned} warned</span>}
      </div>

      <div className="traffic-fleet__list" role="group" aria-label="Choose a simulated driver to monitor">
        {cars.map((car) => {
          const selected = car.id === selectedDriverId;
          const alert = getDriverAlert(snapshot, car.id);
          const status = car.finished ? 'Arrived' : car.speedMps === 0 ? 'Stopped' : `${Math.round(car.speedMps * 3.6)} km/h`;
          return (
            <button
              key={car.id}
              type="button"
              className={`traffic-fleet__driver ${selected ? 'traffic-fleet__driver--selected' : ''}`}
              onClick={() => onSelectDriver(car.id)}
              disabled={disabled}
              aria-pressed={selected}
              title={`Monitor ${driverDisplayName(car.id)}`}
            >
              <CarFront size={15} strokeWidth={1.8} aria-hidden="true" />
              <span className="traffic-fleet__driver-id">{driverDisplayName(car.id)}</span>
              <span className="traffic-fleet__driver-speed">{status}</span>
              {alert ? (
                <AlertTriangle size={15} className="traffic-fleet__driver-alert" aria-label="Potential encounter warning" />
              ) : selected ? (
                <CheckCircle2 size={15} aria-label="Selected driver" />
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="traffic-fleet__notice">Select a car to view its route and modeled warnings. No live vehicle telemetry.</p>
    </section>
  );
}
