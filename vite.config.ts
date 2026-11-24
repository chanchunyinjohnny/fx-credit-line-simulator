import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Relative base so the build works from any path, including a GitHub Pages project site.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { include: ['tests/**/*.test.ts'] },
});
