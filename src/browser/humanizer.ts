/**
 * Human-like interaction simulation for Playwright pages.
 * Provides methods that mimic real user behaviour: Bezier-curve mouse
 * movements, Gaussian-distributed typing delays, occasional typos,
 * smooth scrolling, and reading simulation.
 */

import type { Page } from 'playwright';
import { getLogger } from '../shared/logger.js';

const logger = getLogger('browser', { component: 'humanizer' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Humanizer class
// ---------------------------------------------------------------------------

export class Humanizer {
  /** Last known cursor X position. Defaults to -1 (unknown). */
  private lastMouseX = -1;

  /** Last known cursor Y position. Defaults to -1 (unknown). */
  private lastMouseY = -1;

  // -----------------------------------------------------------------------
  // Public methods
  // -----------------------------------------------------------------------

  /**
   * Click an element with human-like mouse movement: move along a Bezier
   * curve to the element, add a small random offset within its bounds,
   * pause briefly, then click.
   */
  async humanClick(page: Page, selector: string): Promise<void> {
    const element = await page.waitForSelector(selector, { state: 'visible', timeout: 10_000 });
    if (!element) {
      throw new Error(`Element not found for humanClick: ${selector}`);
    }

    const box = await element.boundingBox();
    if (!box) {
      throw new Error(`Element has no bounding box: ${selector}`);
    }

    // Target point with random offset inside the element
    const targetX = box.x + box.width * (0.2 + Math.random() * 0.6);
    const targetY = box.y + box.height * (0.2 + Math.random() * 0.6);

    // Use tracked cursor position; fall back to viewport centre only if unknown
    let startX: number;
    let startY: number;
    if (this.lastMouseX >= 0 && this.lastMouseY >= 0) {
      startX = this.lastMouseX;
      startY = this.lastMouseY;
    } else {
      const viewport = page.viewportSize();
      startX = viewport ? viewport.width / 2 + gaussianRandom(0, 50) : 400;
      startY = viewport ? viewport.height / 2 + gaussianRandom(0, 50) : 300;
    }

    await this.humanMoveMouse(page, targetX, targetY, { startX, startY });

    // Small delay before clicking (human reaction time)
    await humanWait(50, 200);

    await page.mouse.click(targetX, targetY, {
      delay: Math.floor(gaussianRandom(60, 20)),
    });

    // Update tracked position to where we clicked
    this.lastMouseX = targetX;
    this.lastMouseY = targetY;

    logger.debug({ selector, x: Math.round(targetX), y: Math.round(targetY) }, 'Human click');
  }

  /**
   * Type text into a field with human-like characteristics: click the field
   * first, then type each character with variable delay, occasional pauses
   * between words, and occasional typo-then-backspace.
   */
  async humanType(page: Page, selector: string, text: string): Promise<void> {
    // Click the field first
    await this.humanClick(page, selector);
    await humanWait(100, 300);

    // Clear any existing content
    await page.keyboard.press('Control+a');
    await humanWait(30, 80);
    await page.keyboard.press('Backspace');
    await humanWait(50, 150);

    for (let i = 0; i < text.length; i++) {
      const char = text[i]!;

      // 5% chance of a typo (type a nearby key, then backspace)
      if (Math.random() < 0.05 && char.match(/[a-zA-Z]/)) {
        const typoChar = getAdjacentKey(char);
        await page.keyboard.type(typoChar, { delay: Math.floor(gaussianRandom(80, 25)) });
        await humanWait(100, 400);
        await page.keyboard.press('Backspace');
        await humanWait(50, 150);
      }

      // Type the actual character
      const delay = Math.floor(gaussianRandom(90, 30));
      await page.keyboard.type(char, { delay: Math.max(20, delay) });

      // Occasional longer pause (e.g. between words or "thinking")
      if (char === ' ' && Math.random() < 0.3) {
        await humanWait(150, 600);
      }
    }

    logger.debug({ selector, textLength: text.length }, 'Human type');
  }

  /**
   * Smooth scroll the page in the given direction.
   */
  async humanScroll(
    page: Page,
    direction: 'up' | 'down',
    amount?: number,
  ): Promise<void> {
    const scrollAmount = amount ?? Math.floor(gaussianRandom(300, 100));
    const steps = Math.floor(gaussianRandom(8, 3));
    const effectiveSteps = Math.max(3, steps);
    const stepAmount = scrollAmount / effectiveSteps;
    const sign = direction === 'down' ? 1 : -1;

    for (let i = 0; i < effectiveSteps; i++) {
      const delta = stepAmount * sign * (0.8 + Math.random() * 0.4);
      await page.mouse.wheel(0, delta);
      await humanWait(20, 80);
    }

    logger.debug({ direction, amount: scrollAmount }, 'Human scroll');
  }

  /**
   * Move the mouse from a start point (or the current approximated position)
   * to the target coordinates along a Bezier curve with multiple control points.
   * Uses a Fitts's Law-inspired velocity profile: slow at the start (acceleration),
   * fast in the middle (ballistic phase), and slow at the end (correction phase).
   */
  async humanMoveMouse(
    page: Page,
    x: number,
    y: number,
    options?: { startX?: number; startY?: number },
  ): Promise<void> {
    const viewport = page.viewportSize();
    const startX = options?.startX ?? (this.lastMouseX >= 0 ? this.lastMouseX : (viewport ? viewport.width / 2 : 400));
    const startY = options?.startY ?? (this.lastMouseY >= 0 ? this.lastMouseY : (viewport ? viewport.height / 2 : 300));

    const start: Point = { x: startX, y: startY };
    const end: Point = { x, y };
    const steps = Math.max(15, Math.floor(gaussianRandom(30, 10)));

    const path = bezierCurve(start, end, steps);

    // Base delay range for the movement
    const minDelay = 2;
    const maxDelay = 18;

    for (let i = 0; i < path.length; i++) {
      const jittered = addNaturalJitter(path[i]!, 1.5);
      await page.mouse.move(jittered.x, jittered.y);

      // Fitts's Law bell-curve speed: sin(progress * PI) gives 0 at
      // start/end (slow) and 1 at midpoint (fast). We invert it for
      // delay so that high speed = low delay.
      const progress = path.length > 1 ? i / (path.length - 1) : 0.5;
      const speedFactor = Math.sin(progress * Math.PI); // 0..1..0
      // High speedFactor => low delay (fast), low speedFactor => high delay (slow)
      const delay = maxDelay - speedFactor * (maxDelay - minDelay);
      await humanWait(Math.floor(delay), Math.floor(delay + 4));
    }

    // Track the final cursor position
    this.lastMouseX = x;
    this.lastMouseY = y;
  }

  /**
   * Simulate a human reading the page: scroll down slowly, pause, and
   * make small mouse movements.
   */
  async simulateReading(page: Page): Promise<void> {
    const readingTimeMs = Math.floor(gaussianRandom(3500, 800));
    const scrollSteps = Math.floor(readingTimeMs / 500);

    for (let i = 0; i < scrollSteps; i++) {
      await this.humanScroll(page, 'down', Math.floor(gaussianRandom(80, 30)));
      await this.jiggleMouse(page);
      await humanWait(300, 800);
    }

    logger.debug({ readingTimeMs }, 'Simulated reading');
  }

  /**
   * Small random mouse movements to appear human (prevents idle detection).
   */
  async jiggleMouse(page: Page): Promise<void> {
    const viewport = page.viewportSize();
    if (!viewport) return;

    const baseX = viewport.width / 2 + gaussianRandom(0, 100);
    const baseY = viewport.height / 2 + gaussianRandom(0, 100);

    const jiggleCount = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < jiggleCount; i++) {
      const dx = gaussianRandom(0, 15);
      const dy = gaussianRandom(0, 15);
      await page.mouse.move(
        Math.max(0, Math.min(viewport.width, baseX + dx)),
        Math.max(0, Math.min(viewport.height, baseY + dy)),
      );
      await humanWait(30, 100);
    }
  }

  /**
   * Human-like dropdown selection: click the dropdown, wait, then select
   * the desired value.
   */
  async humanSelectDropdown(
    page: Page,
    selector: string,
    value: string,
  ): Promise<void> {
    // Click the dropdown to open it
    await this.humanClick(page, selector);
    await humanWait(200, 500);

    // Select the value
    await page.selectOption(selector, value);
    await humanWait(100, 300);

    logger.debug({ selector, value }, 'Human dropdown select');
  }
}

// ---------------------------------------------------------------------------
// Standalone wait function (also exported for external use)
// ---------------------------------------------------------------------------

/**
 * Wait for a random duration between min and max milliseconds,
 * drawn from a Gaussian distribution centred between the bounds.
 */
export async function humanWait(minMs = 500, maxMs = 2000): Promise<void> {
  const mean = (minMs + maxMs) / 2;
  const stddev = (maxMs - minMs) / 4;
  let ms = gaussianRandom(mean, stddev);
  ms = Math.max(minMs, Math.min(maxMs, ms));
  return new Promise(resolve => setTimeout(resolve, Math.floor(ms)));
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Generate points along a Bezier curve from `start` to `end`
 * with 2-3 randomly placed control points for a natural-looking path.
 */
function bezierCurve(start: Point, end: Point, steps: number): Point[] {
  const controlPointCount = Math.random() > 0.5 ? 3 : 2;
  const controlPoints: Point[] = [];

  for (let i = 0; i < controlPointCount; i++) {
    const t = (i + 1) / (controlPointCount + 1);
    const baseX = start.x + (end.x - start.x) * t;
    const baseY = start.y + (end.y - start.y) * t;

    // Offset perpendicular to the line
    const distance = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
    const maxDeviation = distance * 0.3;

    controlPoints.push({
      x: baseX + gaussianRandom(0, maxDeviation / 2),
      y: baseY + gaussianRandom(0, maxDeviation / 2),
    });
  }

  const allPoints = [start, ...controlPoints, end];
  const path: Point[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push(deCasteljau(allPoints, t));
  }

  return path;
}

/**
 * De Casteljau's algorithm for evaluating a Bezier curve at parameter t.
 */
function deCasteljau(points: Point[], t: number): Point {
  if (points.length === 1) {
    return points[0]!;
  }

  const next: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    next.push({
      x: p0.x * (1 - t) + p1.x * t,
      y: p0.y * (1 - t) + p1.y * t,
    });
  }

  return deCasteljau(next, t);
}

/**
 * Box-Muller transform for generating Gaussian-distributed random values.
 */
function gaussianRandom(mean: number, stddev: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const normal = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + stddev * normal;
}

/**
 * Add small random pixel jitter to a point to simulate imprecise human control.
 */
function addNaturalJitter(point: Point, maxPixels: number): Point {
  return {
    x: point.x + gaussianRandom(0, maxPixels / 2),
    y: point.y + gaussianRandom(0, maxPixels / 2),
  };
}

/**
 * Returns a character "adjacent" to the given key on a QWERTY layout,
 * used to simulate realistic typos.
 */
function getAdjacentKey(char: string): string {
  const qwertyLayout: Record<string, string[]> = {
    q: ['w', 'a'], w: ['q', 'e', 's'], e: ['w', 'r', 'd'], r: ['e', 't', 'f'],
    t: ['r', 'y', 'g'], y: ['t', 'u', 'h'], u: ['y', 'i', 'j'], i: ['u', 'o', 'k'],
    o: ['i', 'p', 'l'], p: ['o', 'l'],
    a: ['q', 'w', 's', 'z'], s: ['a', 'w', 'e', 'd', 'z', 'x'],
    d: ['s', 'e', 'r', 'f', 'x', 'c'], f: ['d', 'r', 't', 'g', 'c', 'v'],
    g: ['f', 't', 'y', 'h', 'v', 'b'], h: ['g', 'y', 'u', 'j', 'b', 'n'],
    j: ['h', 'u', 'i', 'k', 'n', 'm'], k: ['j', 'i', 'o', 'l', 'm'],
    l: ['k', 'o', 'p'],
    z: ['a', 's', 'x'], x: ['z', 's', 'd', 'c'], c: ['x', 'd', 'f', 'v'],
    v: ['c', 'f', 'g', 'b'], b: ['v', 'g', 'h', 'n'], n: ['b', 'h', 'j', 'm'],
    m: ['n', 'j', 'k'],
  };

  const lower = char.toLowerCase();
  const adjacent = qwertyLayout[lower];
  if (!adjacent || adjacent.length === 0) {
    return char;
  }

  const typo = adjacent[Math.floor(Math.random() * adjacent.length)]!;
  return char === char.toUpperCase() ? typo.toUpperCase() : typo;
}
