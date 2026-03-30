import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        timeout: 5000,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            console.warn(`[proxy] Backend indisponible (${err.code || err.message}) — lance "npm run dev" pour démarrer le serveur API`);
            if (res && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Backend indisponible', code: err.code }));
            }
          });
        },
      },
      '/ws': {
        target: 'http://localhost:8787',
        ws: true,
      },
    },
  },
})

// récuperer
