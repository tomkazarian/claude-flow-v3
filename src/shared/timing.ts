/**
 * Human-like timing utilities.
 *
 * All random delays use the Box-Muller transform (Gaussian distribution)
 * so that values cluster around a natural mean rather than being
 * uniformly distributed, which looks robotic.
 */

/**
 * Box-Muller transform: generates a normally distributed random number
 * with the given mean and standard deviation.
 */
function gaussian(mean: number, stdDev: number): number {
  let u1 = Math.random();
  let u2 = Math.random();

  // Avoid log(0)
  while (u1 === 0) {
    u1 = Math.random();
  }

  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z0 * stdDev;
}

/**
 * Returns a promise that resolves after `ms` milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Returns a random number uniformly distributed in [min, max].
 */
export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Delays for a duration drawn from a Gaussian distribution.
 * The delay is clamped to a minimum of 0 ms.
 */
export async function gaussianDelay(meanMs: number, stdDevMs: number): Promise<void> {
  const delay = Math.max(0, Math.round(gaussian(meanMs, stdDevMs)));
  await sleep(delay);
}

/**
 * Simulates realistic human typing speed.
 * Each character takes 50-120 ms on average, with Gaussian variance
 * per character to simulate natural rhythm variation.
 */
export async function humanTypingDelay(charCount: number): Promise<void> {
  let totalMs = 0;
  for (let i = 0; i < charCount; i++) {
    // Mean 85ms per char, stddev 20ms, clamped to [50, 120]
    const perChar = Math.min(120, Math.max(50, gaussian(85, 20)));
    totalMs += perChar;
  }
  await sleep(Math.round(totalMs));
}

/**
 * Simulates the small hesitation before a human clicks a button.
 * Range: 100-400 ms, Gaussian centered at 200 ms.
 */
export async function humanClickDelay(): Promise<void> {
  const delay = Math.min(400, Math.max(100, gaussian(200, 60)));
  await sleep(Math.round(delay));
}

/**
 * Simulates the pause a human takes while scrolling.
 * Range: 200-800 ms, Gaussian centered at 450 ms.
 */
export async function humanScrollDelay(): Promise<void> {
  const delay = Math.min(800, Math.max(200, gaussian(450, 120)));
  await sleep(Math.round(delay));
}

/**
 * Simulates a human waiting for a page to visually load
 * before interacting. Range: 1000-3000 ms, centered at 1800 ms.
 */
export async function humanPageLoadWait(): Promise<void> {
  const delay = Math.min(3000, Math.max(1000, gaussian(1800, 400)));
  await sleep(Math.round(delay));
}
