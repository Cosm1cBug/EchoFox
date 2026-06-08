/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev-mode proxy so 'npm run dev' on :5173 transparently hits the bot
// dashboard server on :3001 for API calls + auth. In prod, both are
// served from the same origin under /dashboard so no proxy needed.
const BOT_DASHBOARD_PORT = Number(process.env.ECHOFOX_DASHBOARD_PORT) || 3001;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/dashboard/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${BOT_DASHBOARD_PORT}`,
        changeOrigin: true,
      },
    },
  },
});