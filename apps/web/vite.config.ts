import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const operatorKey = process.env.EVRAS_DEMO_OPERATOR_KEY ?? env.EVRAS_DEMO_OPERATOR_KEY;

  if (!operatorKey || operatorKey.length < 16) {
    throw new Error('Set EVRAS_DEMO_OPERATOR_KEY (16+ characters) in apps/web/.env.local; it must match the API server.');
  }

  return {
    plugins: [react()],
    server: {
      host: 'localhost',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api(?=\/|$)/, '/demo'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('x-demo-operator-key', operatorKey);
            });
          },
        },
        '/socket.io': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
