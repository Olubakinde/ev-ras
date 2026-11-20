import type {
  AdvanceResponse,
  DriverSession,
  OperatorSnapshot,
  RouteMetadata,
  ScenarioResponse,
} from './scene';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new Error('Cannot reach EV-RAS. Start the NestJS API on port 3000.');
  }

  if (!response.ok) {
    const details: unknown = await response.json().catch(() => null);
    const message =
      details && typeof details === 'object' && 'message' in details
        ? (details as { message: unknown }).message
        : null;
    throw new Error(
      typeof message === 'string'
        ? message
        : `Request failed (${response.status}). Check the API server.`,
    );
  }
  return (await response.json()) as T;
}

function post<T>(path: string, value?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify(value ?? {}),
  });
}

export const api = {
  state: () => request<OperatorSnapshot>('/state'),
  routes: () => request<RouteMetadata>('/routes'),
  session: () => post<DriverSession>('/sessions', { driverId: 'CAR-001' }),
  step: (deltaMs: number) => post<AdvanceResponse>('/advance', { deltaMs }),
  reset: () => post<OperatorSnapshot>('/reset'),
  loadScenario: (scenario: unknown) => post<ScenarioResponse>('/route-scenario', scenario),
};
