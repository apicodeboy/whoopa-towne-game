import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 4173,
    host: true,
  },
  build: {
    target: 'es2022',
    // the physics engine ships its WebAssembly inlined (~4 MB before gzip): expected, not a mistake
    chunkSizeWarningLimit: 4500,
    rolldownOptions: {
      output: {
        // Keep the two big libraries in their own files: they download in parallel with the
        // game code and stay cached in the browser when only the game code changes.
        codeSplitting: {
          groups: [
            { name: 'physics', test: /node_modules[\\/]@dimforge/ },
            { name: 'three', test: /node_modules[\\/]three/ },
          ],
        },
      },
    },
  },
});
