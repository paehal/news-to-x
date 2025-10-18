import { fetchWithTimeout } from '../utils/fetch.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('x-media-v2');

export const uploadMediaV2 = async (accessToken: string, buffer: Buffer, altText?: string): Promise<string> => {
  const payload = {
    media: buffer.toString('base64'),
    media_category: 'tweet_image',
    alt_text: altText ? { text: altText.slice(0, 1000) } : undefined,
  };

  const response = await fetchWithTimeout('https://upload.twitter.com/2/media', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as { media_id?: string; error?: unknown };
  if (!response.ok || !data.media_id) {
    throw new Error(`v2 メディアアップロードに失敗しました: ${JSON.stringify(data)}`);
  }
  logger.debug(`v2 media_id: ${data.media_id}`);
  return data.media_id;
};
