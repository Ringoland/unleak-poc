import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { logger } from '../utils/logger';

export interface ConsoleLogEntry {
  timestamp: string;
  type: string; // 'log', 'info', 'warn', 'error', 'debug'
  text: string;
  location?: string;
  args?: any[];
}

export interface NetworkRequest {
  url: string;
  method: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  timing: {
    startTime: number;
    endTime: number;
    duration: number;
  };
}

export interface EvidenceCapture {
  screenshot: Buffer;
  html: string;
  consoleLogs: ConsoleLogEntry[];
  har: any; // HAR (HTTP Archive) format
  title: string;
  url: string;
  timestamp: string;
  metadata: {
    loadTime: number;
    finalUrl: string;
    viewport: { width: number; height: number };
  };
}

export interface ScanOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
  viewport?: { width: number; height: number };
  userAgent?: string;
  captureHAR?: boolean;
}

export class BrowserService {
  private browser: Browser | null = null;

  async initialize(): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      logger.info('Browser initialized');
    }
  }

  async createPage(): Promise<Page> {
    if (!this.browser) {
      await this.initialize();
    }

    const page = await this.browser!.newPage();
    return page;
  }

  /**
   * Capture comprehensive evidence from a URL
   */
  async captureEvidence(url: string, options: ScanOptions = {}): Promise<EvidenceCapture> {
    const startTime = Date.now();
    const consoleLogs: ConsoleLogEntry[] = [];

    const {
      waitUntil = 'networkidle',
      timeout = 30000,
      viewport = { width: 1920, height: 1080 },
      userAgent,
      captureHAR = true,
    } = options;

    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      if (!this.browser) {
        await this.initialize();
      }

      // Create context with HAR recording if enabled
      const contextOptions: any = {
        viewport,
        userAgent:
          userAgent ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      };

      if (captureHAR) {
        contextOptions.recordHar = {
          path: `/tmp/har_${Date.now()}.har`,
          mode: 'minimal',
        };
      }

      context = await this.browser!.newContext(contextOptions);
      page = await context.newPage();

      // Capture console logs
      page.on('console', (msg) => {
        consoleLogs.push({
          timestamp: new Date().toISOString(),
          type: msg.type(),
          text: msg.text(),
          location: msg.location().url,
        });
      });

      // Capture page errors
      page.on('pageerror', (error) => {
        consoleLogs.push({
          timestamp: new Date().toISOString(),
          type: 'error',
          text: error.message,
        });
      });

      // Navigate to URL
      logger.info(`Navigating to ${url}`);
      const response = await page.goto(url, {
        waitUntil,
        timeout,
      });

      if (!response) {
        throw new Error('Navigation failed: no response received');
      }

      const loadTime = Date.now() - startTime;
      logger.info(`Page loaded in ${loadTime}ms`);

      // Wait a bit for dynamic content
      await page.waitForTimeout(2000);

      // Capture screenshot (full page)
      const screenshot = await page.screenshot({
        fullPage: true,
        type: 'png',
      });

      // Capture HTML
      const html = await page.content();

      // Get page title
      const title = await page.title();

      // Get final URL (after redirects)
      const finalUrl = page.url();

      // Get HAR data if enabled
      let har = null;
      if (captureHAR && context) {
        await context.close();
        context = null;
        page = null;

        // Read HAR file if it was created
        if (contextOptions.recordHar?.path) {
          try {
            const fs = await import('fs/promises');
            const harContent = await fs.readFile(contextOptions.recordHar.path, 'utf-8');
            har = JSON.parse(harContent);
            // Clean up temp HAR file
            await fs.unlink(contextOptions.recordHar.path);
          } catch (error) {
            logger.warn('Failed to read HAR file:', error);
          }
        }
      }

      logger.info(
        `Evidence captured for ${url}: ${consoleLogs.length} console logs, ${html.length} bytes HTML`
      );

      return {
        screenshot,
        html,
        consoleLogs,
        har,
        title,
        url: finalUrl,
        timestamp: new Date().toISOString(),
        metadata: {
          loadTime,
          finalUrl,
          viewport,
        },
      };
    } catch (error) {
      logger.error(`Failed to capture evidence for ${url}:`, error);
      throw error;
    } finally {
      // Cleanup
      if (page && !page.isClosed()) {
        await page.close();
      }
      if (context) {
        await context.close();
      }
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async scanUrl(url: string): Promise<{ screenshot: Buffer; title: string }> {
    const evidence = await this.captureEvidence(url, {
      waitUntil: 'networkidle',
      captureHAR: false,
    });

    return {
      screenshot: evidence.screenshot,
      title: evidence.title,
    };
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('Browser closed');
    }
  }
}

export const browserService = new BrowserService();
