import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from 'react';

import { createRoot } from 'react-dom/client';

import 'maplibre-gl/dist/maplibre-gl.css';
import App from './App';
import './styles.css';

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(
    error: Error,
  ): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(
    error: Error,
    info: ErrorInfo,
  ): void {
    console.error(
      '[EV-RAS] React application crashed',
      error,
      info.componentStack,
    );
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main
          style={{
            minHeight: '100vh',
            background: '#f7f7f5',
            color: '#202523',
            padding: '48px',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <h1>EV-RAS encountered an error</h1>

          <p>
            The frontend crashed while rendering.
            The error is displayed below.
          </p>

          <pre
            style={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: '8px',
              padding: '20px',
              color: '#b42318',
            }}
          >
            {this.state.error.stack ??
              this.state.error.message}
          </pre>
        </main>
      );
    }

    return this.props.children;
  }
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('React root element was not found');
}

createRoot(root).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
