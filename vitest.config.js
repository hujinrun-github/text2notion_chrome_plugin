import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/__mocks__/chrome.js'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'oauth-worker/**',
      'tests/background/oauth.test.js',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['utils/**', 'background.js', 'scripts/**'],
      thresholds: { lines: 80 },
    },
  },
});
