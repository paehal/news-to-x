import fs from 'fs/promises';
import path from 'path';
import Parser from 'rss-parser';
import { z } from 'zod';
import { createLogger } from '../utils/logger.js';
import { normalizeWhitespace } from '../utils/text.js';
import { hashString } from '../utils/hash.js';
import { AppConfig, Article, FeedSource } from '../types.js';

const logger = createLogger('feeds');
const FEEDS_PATH = path.resolve(process.cwd(), 'feeds.json');

const FeedSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  category: z.string().default('general'),
  language: z.string().optional(),
});

const FeedListSchema = z.array(FeedSchema);

export const loadFeedSources = async (): Promise<FeedSource[]> => {
  try {
    const raw = await fs.readFile(FEEDS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return FeedListSchema.parse(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('feeds.json が存在しません。README の手順に従い用意してください。');
    }
    throw new Error(`feeds.json の読み込みに失敗しました: ${(error as Error).message}`);
  }
};

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'news-to-x/1.0 (+https://github.com/your-org/news-to-x)',
  },
});

const isDomainBlocked = (url: string, blockedDomains: string[]): boolean => {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return blockedDomains.some((blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`));
  } catch {
    return false;
  }
};

export const fetchLatestArticles = async (
  sources: FeedSource[],
  config: AppConfig,
  postedHashes: Set<string>,
): Promise<Article[]> => {
  const collected: Article[] = [];
  const seen = new Set<string>();
  const perCategoryCount = new Map<string, number>();

  const tasks = sources.map(async (source) => {
    try {
      const feed = await parser.parseURL(source.url);
      for (const item of feed.items ?? []) {
        const link = (item.link ?? item.guid ?? '').trim();
        if (!link || seen.has(link)) {
          continue;
        }
        if (isDomainBlocked(link, config.filters.blockDomains)) {
          continue;
        }
        const urlHash = hashString(link);
        if (postedHashes.has(urlHash)) {
          continue;
        }
        seen.add(link);
        const category = source.category ?? 'general';
        const count = perCategoryCount.get(category) ?? 0;
        if (count >= config.maxPerCategory) {
          continue;
        }
        const title = normalizeWhitespace(item.title ?? '');
        if (!title) {
          continue;
        }
        const snippet = normalizeWhitespace(item.contentSnippet ?? '');
        collected.push({
          id: urlHash,
          title: title.slice(0, 160),
          link,
          isoDate: item.isoDate ?? item.pubDate ?? undefined,
          contentSnippet: snippet,
          feedTitle: source.title,
          category,
        });
        perCategoryCount.set(category, count + 1);
        if (collected.length >= config.maxCandidates) {
          break;
        }
      }
    } catch (error) {
      logger.warn(`RSS の取得に失敗しました: ${source.title}`, error);
    }
  });

  await Promise.all(tasks);

  collected.sort((a, b) => {
    const timeA = a.isoDate ? Date.parse(a.isoDate) : 0;
    const timeB = b.isoDate ? Date.parse(b.isoDate) : 0;
    return timeB - timeA;
  });

  return collected.slice(0, config.maxCandidates);
};
