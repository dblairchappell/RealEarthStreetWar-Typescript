import { test, expect } from '@playwright/test';

test('map boots and renders at least one frame', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#map canvas');

  // Measure frames for ~1s
  const frames = await page.evaluate(() => {
    return new Promise<number>((resolve) => {
      let count = 0;
      const start = performance.now();
      function step() {
        count++;
        if (performance.now() - start > 1000) {
          resolve(count);
        } else {
          requestAnimationFrame(step);
        }
      }
      requestAnimationFrame(step);
    });
  });

  expect(frames).toBeGreaterThan(5);
}); 