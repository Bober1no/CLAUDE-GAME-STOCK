import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the client runs on :5173 and proxies Socket.io to the game server on :3000.
// In production the server serves this build, so the client just calls io() on the same origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
      '/health': 'http://localhost:3000',
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
});
