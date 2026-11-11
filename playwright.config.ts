import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: '**/shared-library.spec.ts',
  use: { baseURL: 'http://127.0.0.1:1421', channel: 'chromium' },
  webServer: {
    command: 'MAZE_SHARED_LIBRARY=0 bun run dev',
    url: 'http://127.0.0.1:1421',
    reuseExistingServer: false,
  },
});
