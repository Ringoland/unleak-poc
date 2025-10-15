import { chromium, Browser, Page } from 'playwright';
import { logger } from '../utils/logger';

export class BrowserService {
  private browser: Browser | null = null;

  async initialize(): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
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

  async scanUrl(url: string): Promise<{ screenshot: Buffer; title: string }> {
    const page = await this.createPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      const title = await page.title();
      const screenshot = await page.screenshot();
      
      return { screenshot, title };
    } finally {
      await page.close();
    }
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
