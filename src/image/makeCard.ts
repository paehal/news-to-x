import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { AppConfig, GeneratedCard } from '../types.js';
import { createLogger } from '../utils/logger.js';
import { normalizeWhitespace, wrapJapaneseText, clipByLength, toSafeFileName } from '../utils/text.js';
import { hashBuffer } from '../utils/hash.js';
import { fetchWithTimeout } from '../utils/fetch.js';

const logger = createLogger('image');

interface CardOptions {
  index: number;
  articleTitle: string;
  publisher: string;
  comment: string;
  link: string;
  outputDir: string;
  config: AppConfig;
  ogImageUrl?: string;
}

/**
 * ニュースカード画像を生成。Noto CJK を前提とした SVG オーバーレイ。
 */
export const generateCardImage = async (options: CardOptions): Promise<GeneratedCard> => {
  const { index, articleTitle, publisher, comment, outputDir, config, ogImageUrl } = options;
  const width = config.image.width;
  const height = config.image.height;
  const padding = Math.round(width * 0.06);

  await fs.mkdir(outputDir, { recursive: true });

  const background = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#0f172a',
    },
  });

  const layers: sharp.OverlayOptions[] = [];

  if (config.usePublisherImage && ogImageUrl) {
    try {
      const res = await fetchWithTimeout(ogImageUrl, { timeoutMs: 12000 });
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        const resized = await sharp(buffer)
          .resize(width, height, { fit: 'cover' })
          .blur(40)
          .modulate({ brightness: 0.55 })
          .toBuffer();
        layers.push({ input: resized, blend: 'over' });
      }
    } catch (error) {
      logger.warn(`OG 画像取得に失敗しました (${ogImageUrl})`, error);
    }
  }

  const titleLines = wrapJapaneseText(clipByLength(normalizeWhitespace(articleTitle), 120), 22);
  const commentLines = wrapJapaneseText(clipByLength(comment, config.comment.maxChars), 18);

  const fontFamily = "'Noto Sans CJK JP', 'Noto Sans JP', sans-serif";
  const lineHeight = 56;
  const commentLineHeight = 44;
  const titleStartY = padding + 120;

  const svgParts: string[] = [];
  svgParts.push(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`,
    `<defs>`,
    `<linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">`,
    `<stop offset="0%" stop-color="#0f172a" stop-opacity="0.92"/>`,
    `<stop offset="100%" stop-color="#020617" stop-opacity="0.98"/>`,
    `</linearGradient>`,
    `</defs>`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#gradient)"/>`,
    `<text x="${padding}" y="${padding + 40}" font-size="36" font-family="${fontFamily}" font-weight="700" fill="#60a5fa">最新ニュース</text>`,
    `<text x="${padding}" y="${padding + 80}" font-size="28" font-family="${fontFamily}" fill="#e2e8f0">${publisher}</text>`,
  );

  titleLines.forEach((line, idx) => {
    const y = titleStartY + idx * lineHeight;
    svgParts.push(
      `<text x="${padding}" y="${y}" font-size="48" font-family="${fontFamily}" font-weight="700" fill="#f8fafc">${line}</text>`,
    );
  });

  const commentStartY = titleStartY + titleLines.length * lineHeight + 60;
  const commentBoxHeight = commentLineHeight * commentLines.length + 48;

  svgParts.push(
    `<rect x="${padding}" y="${commentStartY - commentLineHeight}" width="${width - padding * 2}" height="${commentBoxHeight}" rx="28" fill="#1d4ed8" fill-opacity="0.88"/>`,
  );

  commentLines.forEach((line, idx) => {
    const y = commentStartY + idx * commentLineHeight + 16;
    svgParts.push(
      `<text x="${padding + 32}" y="${y}" font-size="34" font-family="${fontFamily}" fill="#f8fafc">${line}</text>`,
    );
  });

  const footerHeight = 80;
  svgParts.push(
    `<rect x="0" y="${height - footerHeight}" width="${width}" height="${footerHeight}" fill="#000000" fill-opacity="0.55"/>`,
    `<text x="${padding}" y="${height - footerHeight / 2 + 14}" font-size="28" font-family="${fontFamily}" fill="#f8fafc">${config.image.footer}</text>`,
  );

  svgParts.push(`</svg>`);
  const svg = Buffer.from(svgParts.join(''));

  layers.push({ input: svg, blend: 'over' });

  const composed = await background.composite(layers).png({ quality: 90 }).toBuffer();
  const fileName = `candidate-${String(index).padStart(2, '0')}-${toSafeFileName(publisher)}.png`;
  const filePath = path.join(outputDir, fileName);
  await fs.writeFile(filePath, composed);

  return {
    filePath,
    base64: composed.toString('base64'),
    alt: `${publisher} ${articleTitle}`.slice(0, 420),
    hash: hashBuffer(composed),
  };
};
