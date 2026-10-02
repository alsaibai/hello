import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The production build ships a strict CSP: only this origin, plus the Anthropic API for the user's own key.
const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://api.anthropic.com; object-src 'none'; base-uri 'none'";
const cspPlugin = {
  name: 'csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' }],
};

export default defineConfig({
  plugins: [react(), cspPlugin],
  base: './',
  build: { chunkSizeWarningLimit: 900 },
  worker: { format: 'es' },
  server: { port: 3000, host: true },   // dev: http://localhost:3000 (Vite moves to the next free port if it is taken)
  preview: { port: 3000 },
  test: { include: ['tests/**/*.test.js'] },
});
