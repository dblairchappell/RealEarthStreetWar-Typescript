import { test, expect } from '@playwright/test';

// Fail if average FPS over a 1-second sample falls below this value
const FPS_THRESHOLD = 55;

test('map boots and maintains acceptable frame-rate under load', async ({ page }) => {
  // Load the game with 1000 NPCs and the simulation running in a worker
  await page.goto('/?npc=1000&worker=1');
  await page.waitForSelector('#map canvas');
  // Wait until PerfOverlay exists – indicates GameLoop is up
  await page.waitForSelector('#perf-overlay');
  // Give the page a brief moment (500 ms) to settle after heavy load
  await page.waitForTimeout(500);

  // Measure rAF frames for ~1 s and return both frame count and elapsed time
  const { frames, duration } = await page.evaluate(() => {
    return new Promise<{ frames: number; duration: number }>((resolve) => {
      let count = 0;
      const start = performance.now();
      function step() {
        count++;
        const now = performance.now();
        if (now - start > 1000) {
          resolve({ frames: count, duration: now - start });
        } else {
          requestAnimationFrame(step);
        }
      }
      requestAnimationFrame(step);
    });
  });

  const avgFps = (frames * 1000) / duration;
  console.log(`Smoke test – ${frames} frames in ${duration.toFixed(0)} ms → avg ${avgFps.toFixed(1)} fps`);

  // Guardrail: hard fail if frame-rate too low
  expect(avgFps).toBeGreaterThanOrEqual(FPS_THRESHOLD);
}); 