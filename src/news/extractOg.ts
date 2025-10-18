import metascraper from 'metascraper';
import metascraperImage from 'metascraper-image';
import metascraperTitle from 'metascraper-title';
import { createLogger } from '../utils/logger.js';
import { fetchWithTimeout } from '../utils/fetch.js';
import { OgMetadata } from '../types.js';

const logger = createLogger('og');

const scraper = metascraper([metascraperTitle(), metascraperImage()]);

export const extractOgMetadata = async (url: string): Promise<OgMetadata | null> => {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'news-to-x/1.0 (+https://github.com/your-org/news-to-x)',
        Accept: 'text/html,application/xhtml+xml',
      },
      timeoutMs: 15000,
    });
    if (!response.ok) {
      logger.warn(`OG 取得に失敗しました (${response.status}): ${url}`);
      return null;
    }
    const html = await response.text();
    const metadata = await scraper({ html, url });
    return {
      title: metadata.title ?? undefined,
      image: metadata.image ?? metadata['twitter:image'] ?? undefined,
      url: metadata.url ?? url,
    };
  } catch (error) {
    logger.warn(`OG 解析中にエラーが発生しました: ${url}`, error);
    return null;
  }
};
