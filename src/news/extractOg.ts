import metascraper from 'metascraper';
import metascraperImage from 'metascraper-image';
import metascraperTitle from 'metascraper-title';
import sharp from 'sharp';
import { createLogger } from '../utils/logger.js';
import { fetchWithTimeout } from '../utils/fetch.js';
import { ImageLicenseConfig, OgMetadata } from '../types.js';

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

export interface PublisherImageResult {
  url: string;
  buffer: Buffer;
  width: number;
  height: number;
}

const normalizeDomain = (domain: string): string => domain.replace(/^\.+/, '').toLowerCase();

const matchesDomain = (host: string, target: string): boolean => {
  const normalizedHost = host.toLowerCase();
  const normalizedTarget = normalizeDomain(target);
  return (
    normalizedHost === normalizedTarget ||
    normalizedHost.endsWith(`.${normalizedTarget}`)
  );
};

export const resolvePublisherImage = async (
  articleUrl: string,
  rawImageUrl: string | null | undefined,
  license: ImageLicenseConfig,
): Promise<PublisherImageResult | null> => {
  if (!rawImageUrl) {
    return null;
  }

  let resolvedUrl: string;
  try {
    resolvedUrl = new URL(rawImageUrl, articleUrl).href;
  } catch (error) {
    logger.warn('OG 画像 URL の解決に失敗しました', error);
    return null;
  }

  let host: string;
  try {
    host = new URL(resolvedUrl).hostname;
  } catch (error) {
    logger.warn('OG 画像のホスト判定に失敗しました', error);
    return null;
  }

  const allowed =
    !license.allowDomains.length || license.allowDomains.some((domain) => matchesDomain(host, domain));
  const blocked = license.blockDomains.some((domain) => matchesDomain(host, domain));

  if (!allowed || blocked) {
    logger.info(`OG 画像の利用をスキップしました（ドメイン制約）: ${resolvedUrl}`);
    return null;
  }

  let response;
  try {
    response = await fetchWithTimeout(resolvedUrl, {
      headers: {
        'User-Agent': 'news-to-x/1.0 (+https://github.com/your-org/news-to-x)',
        Referer: articleUrl,
      },
      timeoutMs: 15000,
    });
  } catch (error) {
    logger.warn('OG 画像のダウンロードに失敗しました', error);
    return null;
  }

  if (!response.ok) {
    logger.warn(`OG 画像の取得に失敗しました (${response.status})`);
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType && !contentType.startsWith('image/')) {
    logger.warn(`コンテンツタイプが画像ではありません (${contentType})`);
    return null;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    logger.warn('OG 画像のバッファ化に失敗しました', error);
    return null;
  }

  if (buffer.length < 1024) {
    logger.warn('OG 画像が小さすぎるためスキップします');
    return null;
  }

  try {
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width < license.minSize.width || height < license.minSize.height) {
      logger.info(`OG 画像のサイズが閾値未満のためスキップします (${width}x${height})`);
      return null;
    }
    return { url: resolvedUrl, buffer, width, height };
  } catch (error) {
    logger.warn('OG 画像メタデータの解析に失敗しました', error);
    return null;
  }
};
