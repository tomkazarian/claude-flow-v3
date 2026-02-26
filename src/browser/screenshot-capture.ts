/**
 * Screenshot and DOM snapshot capture for failure diagnosis and entry proof.
 * Saves PNGs and HTML snapshots to `./data/screenshots/` with automatic
 * cleanup of old files based on a configurable retention period.
 */

import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { getLogger } from '../shared/logger.js';

const logger = getLogger('browser', { component: 'screenshot-capture' });

const SCREENSHOT_DIR = './data/screenshots';
const DEFAULT_RETENTION_DAYS = 14;

// ---------------------------------------------------------------------------
// Ensure output directory exists
// ---------------------------------------------------------------------------

let dirReady = false;

async function ensureDir(): Promise<void> {
  if (dirReady) return;
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  dirReady = true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Captures a screenshot and DOM snapshot when an entry attempt fails.
 * Both files are saved with the pattern `{entryId}_{timestamp}_failure`.
 *
 * @returns The path to the saved screenshot PNG.
 */
export async function captureOnFailure(
  page: Page,
  entryId: string,
  error: Error,
): Promise<string> {
  await ensureDir();

  const timestamp = Date.now();
  const baseName = `${entryId}_${timestamp}_failure`;
  const screenshotPath = join(SCREENSHOT_DIR, `${baseName}.png`);
  const htmlPath = join(SCREENSHOT_DIR, `${baseName}.html`);

  try {
    // Capture screenshot
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      type: 'png',
    });

    // Capture DOM snapshot
    const html = await captureDomSnapshot(page, error);
    await writeFile(htmlPath, html, 'utf-8');

    logger.info(
      { entryId, screenshotPath, htmlPath, errorMessage: error.message },
      'Failure screenshot captured',
    );
  } catch (captureError) {
    logger.error(
      { entryId, captureError, originalError: error.message },
      'Failed to capture failure screenshot',
    );
  }

  return screenshotPath;
}

/**
 * Captures a screenshot as proof of a successful sweepstakes entry.
 * Both a PNG and an HTML snapshot are saved.
 *
 * @returns The path to the saved screenshot PNG.
 */
export async function captureEntryProof(
  page: Page,
  entryId: string,
): Promise<string> {
  await ensureDir();

  const timestamp = Date.now();
  const baseName = `${entryId}_${timestamp}_proof`;
  const screenshotPath = join(SCREENSHOT_DIR, `${baseName}.png`);
  const htmlPath = join(SCREENSHOT_DIR, `${baseName}.html`);

  try {
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      type: 'png',
    });

    const html = await captureDomSnapshot(page);
    await writeFile(htmlPath, html, 'utf-8');

    logger.info({ entryId, screenshotPath }, 'Entry proof captured');
  } catch (captureError) {
    logger.error({ entryId, captureError }, 'Failed to capture entry proof');
  }

  return screenshotPath;
}

/**
 * Removes screenshot files older than the retention period.
 *
 * @param retentionDays  Number of days to keep files. Default 14.
 * @returns The number of files deleted.
 */
export async function cleanupOldScreenshots(
  retentionDays = DEFAULT_RETENTION_DAYS,
): Promise<number> {
  await ensureDir();

  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deleted = 0;

  try {
    const entries = await readdir(SCREENSHOT_DIR);

    for (const entry of entries) {
      const filePath = join(SCREENSHOT_DIR, entry);
      try {
        const stats = await stat(filePath);
        if (stats.isFile() && stats.mtimeMs < cutoffMs) {
          await unlink(filePath);
          deleted++;
        }
      } catch (fileError) {
        logger.warn({ filePath, fileError }, 'Error checking/deleting screenshot file');
      }
    }

    if (deleted > 0) {
      logger.info({ deleted, retentionDays }, 'Cleaned up old screenshots');
    }
  } catch (dirError) {
    logger.error({ dirError, retentionDays }, 'Error reading screenshot directory for cleanup');
  }

  return deleted;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Creates an HTML snapshot of the current page state, optionally embedding
 * error information for failure captures.
 */
async function captureDomSnapshot(page: Page, error?: Error): Promise<string> {
  const url = page.url();
  const title = await page.title();
  const content = await page.content();
  const timestamp = new Date().toISOString();

  const errorBlock = error
    ? `
    <div style="background:#fee;border:2px solid #c00;padding:12px;margin:12px;font-family:monospace;">
      <h3 style="color:#c00;margin:0 0 8px;">Error Details</h3>
      <p><strong>Message:</strong> ${escapeHtml(error.message)}</p>
      <p><strong>Name:</strong> ${escapeHtml(error.name)}</p>
      <pre style="white-space:pre-wrap;max-height:300px;overflow:auto;">${escapeHtml(error.stack ?? 'No stack trace')}</pre>
    </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Snapshot: ${escapeHtml(title)}</title>
  <style>
    .snapshot-meta {
      background: #f0f0f0;
      padding: 12px;
      margin: 12px;
      font-family: monospace;
      font-size: 12px;
      border: 1px solid #ccc;
    }
  </style>
</head>
<body>
  <div class="snapshot-meta">
    <p><strong>URL:</strong> ${escapeHtml(url)}</p>
    <p><strong>Title:</strong> ${escapeHtml(title)}</p>
    <p><strong>Captured:</strong> ${timestamp}</p>
  </div>
  ${errorBlock}
  <hr>
  <div id="page-content">
    ${content}
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
