import { defineConfig } from '@playwright/test';

export default defineConfig({
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    launchOptions: {
      args: [
        '--enable-gpu',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows'
      ]
    },
  },
  webServer: {
    command: 'npm run dev',
    cwd: __dirname,
    port: 5173,
    reuseExistingServer: true,
  },
}); 