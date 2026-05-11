import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendPort = Number(env.PORT) || 8787;
  const backendTarget = env.VITE_BACKEND_TARGET || `http://localhost:${backendPort}`;

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
          timeout: 5000,
          configure: (proxy) => {
            proxy.on('error', (err, _req, res) => {
              console.warn(`[proxy] Backend indisponible (${err.code || err.message}) — cible: ${backendTarget}`);
              if (res && !res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Backend indisponible', code: err.code }));
              }
            });
          },
        },
        '/ws': {
          target: backendTarget,
          ws: true,
        },
      },
    },
  };
})

// récuperer
