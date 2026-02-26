/**
 * Instant win game handler.
 *
 * Detects and interacts with common instant-win game types:
 * spin wheels, scratch-offs, click to reveal, and match games.
 */

import { getLogger } from '../shared/logger.js';
import { humanClickDelay, sleep, gaussianDelay } from '../shared/timing.js';
import type { Page, InstantWinResult } from './types.js';

const log = getLogger('entry', { component: 'instant-win-handler' });

const ANIMATION_WAIT_MS = 5_000;

type GameType = 'spin-wheel' | 'scratch-off' | 'click-reveal' | 'match-game' | 'unknown';

/** Selectors for detecting spin wheel games. */
const SPIN_SELECTORS = [
  'canvas[id*="wheel" i]', 'canvas[class*="wheel" i]',
  '.spin-wheel', '.wheel-container', '#wheel',
  '[class*="spin"]', '[id*="spin"]',
  'canvas[id*="spin" i]',
];

const SPIN_BUTTON_SELECTORS = [
  'button:has-text("Spin")', 'button:has-text("spin")',
  'a:has-text("Spin")', '.spin-button', '.btn-spin',
  'button[id*="spin" i]', 'button[class*="spin" i]',
  '#spinButton', '.spin-btn',
];

/** Selectors for scratch-off games. */
const SCRATCH_SELECTORS = [
  'canvas[id*="scratch" i]', 'canvas[class*="scratch" i]',
  '.scratch-card', '.scratch-container', '#scratch',
  '[class*="scratch"]',
];

/** Selectors for click-to-reveal games. */
const REVEAL_SELECTORS = [
  '.reveal-button', '.reveal-card', '.click-to-reveal',
  'button:has-text("Reveal")', 'button:has-text("reveal")',
  'button:has-text("Click")', 'a:has-text("Reveal")',
  '.flip-card', '.prize-card', '.mystery-box',
  '[class*="reveal"]', '[class*="flip"]',
];

/** Win indicator patterns in page text. */
const WIN_PATTERNS = [
  /\bcongratulations\b/i, /\byou\s*(?:have\s*)?won\b/i,
  /\bwinner\b/i, /\byou\s*win\b/i, /\bprize\s*won\b/i,
  /\bclaim\s*your\s*prize\b/i, /\byou're\s*a\s*winner\b/i,
  /\bwinning\b/i,
];

/** Lose indicator patterns in page text. */
const LOSE_PATTERNS = [
  /\bsorry\b/i, /\bbetter\s*luck\b/i, /\btry\s*again\b/i,
  /\bnot\s*(?:a\s*)?winner\b/i, /\bno\s*prize\b/i,
  /\bunfortunately\b/i, /\bdidn'?t\s*win\b/i,
  /\bcome\s*back\b/i, /\bplay\s*again\b/i,
];

export class InstantWinHandler {
  /**
   * Play an instant win game on the page.
   */
  async play(page: Page): Promise<InstantWinResult> {
    log.info('Attempting to play instant win game');

    const gameType = await this.detectGameType(page);
    log.info({ gameType }, 'Game type detected');

    if (gameType === 'unknown') {
      log.warn('Could not detect game type, attempting generic click-to-play');
      return this.attemptGenericPlay(page);
    }

    switch (gameType) {
      case 'spin-wheel':
        return this.playSpinWheel(page);
      case 'scratch-off':
        return this.playScratchOff(page);
      case 'click-reveal':
        return this.playClickReveal(page);
      case 'match-game':
        return this.playMatchGame(page);
    }
  }

  /**
   * Detect the type of instant win game on the page.
   */
  private async detectGameType(page: Page): Promise<GameType> {
    // Check for spin wheel
    for (const sel of SPIN_SELECTORS) {
      try {
        const visible = await page.isVisible(sel);
        if (visible) return 'spin-wheel';
      } catch {
        // Not found
      }
    }

    // Check for scratch-off
    for (const sel of SCRATCH_SELECTORS) {
      try {
        const visible = await page.isVisible(sel);
        if (visible) return 'scratch-off';
      } catch {
        // Not found
      }
    }

    // Check for click-to-reveal
    for (const sel of REVEAL_SELECTORS) {
      try {
        const visible = await page.isVisible(sel);
        if (visible) return 'click-reveal';
      } catch {
        // Not found
      }
    }

    // Check page text for game indicators
    try {
      const gameText = await page.evaluate(() => {
        return document.body.textContent?.toLowerCase() ?? '';
      }) as string;

      if (gameText.includes('spin the wheel') || gameText.includes('spin to win')) {
        return 'spin-wheel';
      }
      if (gameText.includes('scratch') || gameText.includes('scratch off')) {
        return 'scratch-off';
      }
      if (gameText.includes('click to reveal') || gameText.includes('flip') || gameText.includes('reveal your')) {
        return 'click-reveal';
      }
      if (gameText.includes('match') || gameText.includes('memory game')) {
        return 'match-game';
      }
    } catch {
      // Ignore
    }

    return 'unknown';
  }

  /**
   * Play a spin-the-wheel game.
   */
  private async playSpinWheel(page: Page): Promise<InstantWinResult> {
    log.info('Playing spin wheel game');

    // Find and click the spin button
    const spinButton = await this.findElement(page, SPIN_BUTTON_SELECTORS);
    if (!spinButton) {
      log.warn('Could not find spin button');
      return { played: false, won: false };
    }

    await humanClickDelay();
    await page.click(spinButton);

    // Wait for the spin animation to complete
    log.debug('Waiting for spin animation');
    await sleep(ANIMATION_WAIT_MS);
    await this.waitForAnimationComplete(page);

    return this.detectResult(page);
  }

  /**
   * Play a scratch-off game by simulating mouse drag.
   */
  private async playScratchOff(page: Page): Promise<InstantWinResult> {
    log.info('Playing scratch-off game');

    const scratchArea = await this.findElement(page, SCRATCH_SELECTORS);
    if (!scratchArea) {
      log.warn('Could not find scratch area');
      return { played: false, won: false };
    }

    // Get the element's bounding box via evaluate
    const bounds = await page.evaluate(
      (sel: unknown) => {
        const el = document.querySelector(sel as string);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      },
      scratchArea,
    ) as { x: number; y: number; width: number; height: number } | null;

    if (!bounds) {
      log.warn('Could not get scratch area bounds');
      return { played: false, won: false };
    }

    // Simulate scratching by dragging across the area
    await this.simulateScratch(page, bounds);

    // Wait for result
    await sleep(2000);

    return this.detectResult(page);
  }

  /**
   * Play a click-to-reveal game.
   */
  private async playClickReveal(page: Page): Promise<InstantWinResult> {
    log.info('Playing click-to-reveal game');

    const revealElement = await this.findElement(page, REVEAL_SELECTORS);
    if (!revealElement) {
      log.warn('Could not find reveal element');
      return { played: false, won: false };
    }

    await humanClickDelay();
    await page.click(revealElement);

    // Wait for reveal animation
    await sleep(3000);

    return this.detectResult(page);
  }

  /**
   * Play a match/memory game by clicking random pairs.
   */
  private async playMatchGame(page: Page): Promise<InstantWinResult> {
    log.info('Playing match game');

    // Find clickable game tiles/cards
    const tileSelectors = [
      '.game-tile', '.match-card', '.memory-card', '.game-card',
      '[class*="tile"]', '[class*="card"]',
    ];

    const tileSelector = await this.findElement(page, tileSelectors);
    if (!tileSelector) {
      log.warn('Could not find game tiles');
      return { played: false, won: false };
    }

    // Click tiles in sequence
    const tiles = await page.$$(tileSelector);
    const maxClicks = Math.min(tiles.length, 6);

    for (let i = 0; i < maxClicks; i++) {
      try {
        await humanClickDelay();
        await page.click(`${tileSelector}:nth-child(${i + 1})`);
        await gaussianDelay(800, 200);
      } catch {
        break;
      }
    }

    await sleep(3000);

    return this.detectResult(page);
  }

  /**
   * Attempt a generic play action when game type is unknown.
   */
  private async attemptGenericPlay(page: Page): Promise<InstantWinResult> {
    log.info('Attempting generic instant-win play');

    const playButtonSelectors = [
      'button:has-text("Play")', 'button:has-text("play")',
      'button:has-text("Start")', 'button:has-text("start")',
      'a:has-text("Play")', 'a:has-text("Start")',
      '.play-button', '.start-button', '.btn-play',
      'button[id*="play" i]', 'button[class*="play" i]',
    ];

    const playButton = await this.findElement(page, playButtonSelectors);
    if (!playButton) {
      log.warn('Could not find any play button');
      return { played: false, won: false };
    }

    await humanClickDelay();
    await page.click(playButton);
    await sleep(ANIMATION_WAIT_MS);

    return this.detectResult(page);
  }

  /**
   * Detect win/lose result from the page after playing.
   */
  private async detectResult(page: Page): Promise<InstantWinResult> {
    log.debug('Detecting game result');

    // Wait a bit for results to render
    await sleep(2000);

    try {
      const resultText = await page.evaluate(() => {
        return document.body.textContent ?? '';
      }) as string;

      // Check for win
      for (const pattern of WIN_PATTERNS) {
        if (pattern.test(resultText)) {
          const prize = this.extractPrize(resultText);
          log.info({ prize }, 'WIN detected');
          return { played: true, won: true, prize };
        }
      }

      // Check for lose
      for (const pattern of LOSE_PATTERNS) {
        if (pattern.test(resultText)) {
          log.info('LOSE detected');
          return { played: true, won: false };
        }
      }

      // Could not determine result
      log.info('Could not determine win/lose result');
      return { played: true, won: false };
    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error detecting game result',
      );
      return { played: true, won: false };
    }
  }

  /**
   * Extract prize description from result text.
   */
  private extractPrize(text: string): string {
    // Try to find prize text near win indicators
    const prizePatterns = [
      /(?:you\s*(?:have\s*)?won|prize[:\s]+|congratulations[!,\s]+)(.{5,100}?)(?:\.|!|$)/i,
      /\$[\d,]+(?:\.\d{2})?/,
      /win(?:ner of|ning)?\s+(?:a\s+)?(.{5,100}?)(?:\.|!|$)/i,
    ];

    for (const pattern of prizePatterns) {
      const match = text.match(pattern);
      if (match) {
        return (match[1] ?? match[0]).trim();
      }
    }

    return 'Prize won (details unavailable)';
  }

  /**
   * Simulate scratching a scratch-off area with mouse movements.
   */
  private async simulateScratch(
    page: Page,
    bounds: { x: number; y: number; width: number; height: number },
  ): Promise<void> {
    const { x, y, width, height } = bounds;
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    // Move to the scratch area
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();

    // Zigzag pattern across the area
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const stepX = x + (width * i) / steps + Math.random() * 20;
      const stepY = i % 2 === 0
        ? y + height * 0.3 + Math.random() * 10
        : y + height * 0.7 + Math.random() * 10;

      await page.mouse.move(stepX, stepY, { steps: 5 });
      await sleep(100);
    }

    // Second pass
    for (let i = steps - 1; i >= 0; i--) {
      const stepX = x + (width * i) / steps + Math.random() * 20;
      const stepY = i % 2 === 0
        ? y + height * 0.6 + Math.random() * 10
        : y + height * 0.4 + Math.random() * 10;

      await page.mouse.move(stepX, stepY, { steps: 5 });
      await sleep(100);
    }

    await page.mouse.up();
  }

  /**
   * Wait for animations to complete on the page.
   */
  private async waitForAnimationComplete(page: Page): Promise<void> {
    try {
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          const check = () => {
            const animations = document.getAnimations();
            if (animations.length === 0) {
              resolve();
              return;
            }
            const pending = animations.filter((a) => a.playState === 'running');
            if (pending.length === 0) {
              resolve();
              return;
            }
            setTimeout(check, 500);
          };
          // Also set a max wait
          setTimeout(resolve, 10_000);
          check();
        });
      });
    } catch {
      // Fallback: just wait
      await sleep(3000);
    }
  }

  /**
   * Find the first visible element matching one of the selectors.
   */
  private async findElement(page: Page, selectors: string[]): Promise<string | null> {
    for (const sel of selectors) {
      try {
        const visible = await page.isVisible(sel);
        if (visible) return sel;
      } catch {
        // Not found
      }
    }
    return null;
  }
}
