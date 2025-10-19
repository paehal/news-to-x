import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { AppConfig, GeneratedCard, ImageOverlayConfig } from '../types.js';
import { createLogger } from '../utils/logger.js';
import { normalizeWhitespace, wrapJapaneseText, clipByLength } from '../utils/text.js';
import { hashBuffer } from '../utils/hash.js';

const logger = createLogger('image');

interface SafeCardOptions {
  index: number;
  articleTitle: string;
  publisher: string;
  comment: string;
  link: string;
  outputDir: string;
  config: AppConfig;
}

interface PublisherOverlayOptions {
  index: number;
  comment: string;
  articleTitle: string;
  publisher: string;
  footer: string;
  outputDir: string;
  width: number;
  height: number;
  overlay: ImageOverlayConfig;
  imageBuffer: Buffer;
}

const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true });
};

const writeResult = async (filePath: string, fileName: string, buffer: Buffer, alt: string): Promise<GeneratedCard> => {
  await fs.writeFile(filePath, buffer);
  return {
    filePath,
    fileName,
    base64: buffer.toString('base64'),
    alt: alt.slice(0, 420),
    hash: hashBuffer(buffer),
  };
};

export const generateSafeCard = async (options: SafeCardOptions): Promise<GeneratedCard> => {
  const { index, articleTitle, publisher, comment, outputDir, config } = options;
  const width = config.image.width;
  const height = config.image.height;
  const padding = Math.round(width * 0.06);

  await ensureDir(outputDir);

  const background = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#0f172a',
    },
  });

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

  const composed = await background.composite([{ input: svg, blend: 'over' }]).jpeg({ quality: 88 }).toBuffer();
  const fileName = `${index}.jpg`;
  const filePath = path.join(outputDir, fileName);

  return writeResult(filePath, fileName, composed, `${publisher} ${articleTitle}`);
};

const escapeXml = (value: string): string => value.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

const wrapOverlayText = (
  text: string,
  maxWidth: number,
  fontPx: number,
  padding: number,
  maxLines: number,
): string[] => {
  const available = maxWidth - padding * 2;
  const perLine = Math.max(4, Math.floor(available / (fontPx * 0.9)));
  const chars = Array.from(text);
  const result: string[] = [];
  let current = '';
  for (const ch of chars) {
    if ((current + ch).length > perLine) {
      result.push(current);
      current = ch;
      if (result.length >= maxLines) {
        break;
      }
    } else {
      current += ch;
    }
  }
  if (result.length < maxLines && current) {
    result.push(current);
  }
  return result.slice(0, maxLines);
};

const buildOverlaySvg = (
  width: number,
  height: number,
  comment: string,
  footer: string,
  overlay: ImageOverlayConfig,
  publisher: string,
): Buffer => {
  const text = normalizeWhitespace(comment);
  let fontPx = 120;
  let lines = wrapOverlayText(text, width, fontPx, overlay.padding, overlay.maxLines);
  while (
    (lines.length > overlay.maxLines ||
      lines.some((line) => line.length * fontPx * 0.9 > width - overlay.padding * 2)) &&
    fontPx > 36
  ) {
    fontPx -= 4;
    lines = wrapOverlayText(text, width, fontPx, overlay.padding, overlay.maxLines);
  }

  const lineHeight = Math.round(fontPx * 1.15);
  const textBlockHeight = lineHeight * lines.length;
  const yStart = Math.round((height - textBlockHeight) / 2 + lineHeight * 0.75);

  const tspans = lines
    .map((line, idx) => {
      const dy = idx === 0 ? 0 : lineHeight;
      return `<tspan x="${width / 2}" dy="${dy}">${escapeXml(line)}</tspan>`;
    })
    .join('');

  const filterDefs = overlay.dropShadow
    ? `<defs>
        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.45" />
        </filter>
      </defs>`
    : '';

  const paintOrder = overlay.stroke ? 'stroke' : 'normal';
  const strokeAttrs = overlay.stroke ? ` stroke="#000" stroke-width="4"` : '';
  const filterAttr = overlay.dropShadow ? ' filter="url(#shadow)"' : '';

  const footerText = footer ? footer : publisher;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    ${filterDefs}
    <rect width="100%" height="100%" fill="rgba(0,0,0,${overlay.darken})" />
    <text x="${width / 2}" y="${yStart}" text-anchor="middle" font-family="${overlay.fontFamily}" font-size="${fontPx}"
      font-weight="${overlay.fontWeight}" fill="#fff"${filterAttr}${strokeAttrs} paint-order="${paintOrder}">
      ${tspans}
    </text>
    <text x="${width - overlay.padding}" y="${height - overlay.padding / 2}" text-anchor="end"
      font-family="${overlay.fontFamily}" font-size="24" font-weight="600" fill="#fff" opacity="0.9">${escapeXml(footerText)}</text>
  </svg>`;

  return Buffer.from(svg);
};

export const makePublisherOverlayCard = async (options: PublisherOverlayOptions): Promise<GeneratedCard> => {
  const { index, comment, articleTitle, publisher, footer, outputDir, width, height, overlay, imageBuffer } = options;

  await ensureDir(outputDir);

  let base: Buffer;
  try {
    base = await sharp(imageBuffer).rotate().resize(width, height, { fit: 'cover' }).toBuffer();
  } catch (error) {
    logger.warn('OG 画像のリサイズに失敗しました', error);
    throw error;
  }

  const svg = buildOverlaySvg(width, height, comment, footer, overlay, publisher);
  const composed = await sharp(base)
    .composite([{ input: svg, left: 0, top: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();

  const fileName = `${index}.jpg`;
  const filePath = path.join(outputDir, fileName);
  return writeResult(filePath, fileName, composed, `${publisher} ${articleTitle}`);
};
