import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// base './' so the build works at any GitHub Pages path (/languageLearner/ or a custom domain)
export default defineConfig({
  base: './',
  plugins: [preact()],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any)
