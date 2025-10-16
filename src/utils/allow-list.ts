import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

const ALLOW_LIST_PATH = path.resolve(__dirname, '../config/allow-list.csv');

interface AllowListRow {
  url?: string;
}

export function loadAllowList(): string[] {
  if (!fs.existsSync(ALLOW_LIST_PATH)) {
    console.warn(`⚠️ Allow-list file not found: ${ALLOW_LIST_PATH}`);
    return [];
  }

  let content = fs.readFileSync(ALLOW_LIST_PATH, 'utf-8');

  // 🔧 Remove potential BOM character at start of file
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

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

export function isAllowListed(url: string): boolean {
  const allowList = loadAllowList();
  return allowList.includes(url);
}
