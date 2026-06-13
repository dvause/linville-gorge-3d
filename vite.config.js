import { defineConfig } from 'vite';

// Honor a PORT env var when one is provided (e.g. by the preview harness);
// fall back to Vite's usual 5173 for a plain `npm run dev`.
export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
});
