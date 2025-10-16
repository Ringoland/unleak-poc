import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

const ALLOW_LIST_PATH = path.resolve(__dirname, '../../config/allow-list.csv');

interface AllowListRow {
  url?: string;
}

export function loadAllowList(): string[] {
  if (!fs.existsSync(ALLOW_LIST_PATH)) {
    console.warn(`⚠️ Allow-list file not found: ${ALLOW_LIST_PATH}`);
    return [];
  }

  const content = fs.readFileSync(ALLOW_LIST_PATH, 'utf-8');

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as AllowListRow[];

  const urls = records
    .map((row) => row.url)
    .filter((url): url is string => typeof url === 'string' && url.length > 0);

  return urls;
}

/**
 * Checks if a given URL is allow-listed.
 */
export function isAllowListed(url: string): boolean {
  const allowList = loadAllowList();
  return allowList.includes(url);
}
