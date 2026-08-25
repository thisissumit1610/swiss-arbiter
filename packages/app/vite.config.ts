import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The engine is consumed from source rather than from its build output, so a
// change there shows up in the dev server immediately and `npm run build` does
// not depend on the packages being built in the right order.
const enginePath = fileURLToPath(new URL('../engine/src/index.ts', import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@swiss-arbiter/engine': enginePath },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});
