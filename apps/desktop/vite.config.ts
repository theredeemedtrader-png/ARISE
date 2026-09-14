import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  root: 'src/renderer',
  publicDir: '../../../../assets/brand',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
});
