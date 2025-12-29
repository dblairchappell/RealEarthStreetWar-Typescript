/* eslint-disable no-console */
// Simple 5-second frame-time probe. Ensure your dev server is running.
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173');
  await page.waitForSelector('#map canvas');

  const deltas = await page.evaluate(() =>
    new Promise((resolve) => {
      const samples = [];
      let last = performance.now();
      const start = last;
      function step() {
        const now = performance.now();
        samples.push(now - last);
        last = now;
        if (now - start >= 5000) resolve(samples);
        else requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    })
  );

  deltas.shift();
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const sorted = [...deltas].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  console.log(`Avg Δ = ${avg.toFixed(2)} ms | 95th = ${p95.toFixed(2)} ms`);
  await browser.close();
})(); 