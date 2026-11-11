import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'shared-library.spec.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:1422', channel: 'chromium' },
  webServer: {
    command:
      'MAZE_SHARED_LIBRARY=1 MAZE_SHARED_LIBRARY_FILE=work/test-shared-library.json bun run dev -- --port 1422',
    url: 'http://127.0.0.1:1422',
    reuseExistingServer: false,
  },
});
