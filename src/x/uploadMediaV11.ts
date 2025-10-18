import OAuth from 'oauth-1.0a';
import { createHmac } from 'crypto';
import { fetchWithTimeout } from '../utils/fetch.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('x-media-v11');

const createOauthClient = () =>
  new OAuth({
    consumer: {
      key: process.env.X_API_KEY ?? '',
      secret: process.env.X_API_SECRET ?? '',
    },
    signature_method: 'HMAC-SHA1',
    hash_function(base: string, key: string) {
      return createHmac('sha1', key).update(base).digest('base64');
    },
  });

export const uploadMediaV11 = async (buffer: Buffer, altText?: string): Promise<string> => {
  const consumerKey = process.env.X_API_KEY;
  const consumerSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessSecret = process.env.X_ACCESS_TOKEN_SECRET;

  if (!consumerKey || !consumerSecret || !accessToken || !accessSecret) {
    throw new Error('v1.1 メディアアップロードに必要な OAuth1.0a 資格情報が不足しています。');
  }

  const oauth = createOauthClient();
  const url = 'https://upload.twitter.com/1.1/media/upload.json';

  const bodyParams = new URLSearchParams({
    media: buffer.toString('base64'),
    media_category: 'tweet_image',
  });

  const authHeaders = oauth.toHeader(
    oauth.authorize(
      {
        url,
        method: 'POST',
        data: Object.fromEntries(bodyParams.entries()),
      },
      { key: accessToken, secret: accessSecret },
    ),
  );

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: bodyParams.toString(),
  });

  const data = (await response.json()) as { media_id_string?: string; errors?: unknown };
  if (!response.ok || !data.media_id_string) {
    throw new Error(`v1.1 メディアアップロードに失敗しました: ${JSON.stringify(data)}`);
  }

  const mediaId = data.media_id_string;

  if (altText) {
    const metaUrl = 'https://upload.twitter.com/1.1/media/metadata/create.json';
    const payload = { media_id: mediaId, alt_text: { text: altText.slice(0, 1000) } };
    const metaHeaders = oauth.toHeader(
      oauth.authorize(
        {
          url: metaUrl,
          method: 'POST',
          data: payload,
        },
        { key: accessToken, secret: accessSecret },
      ),
    );
    const metaRes = await fetchWithTimeout(metaUrl, {
      method: 'POST',
      headers: {
        ...metaHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!metaRes.ok) {
      logger.warn(`alt テキスト登録に失敗しました: ${await metaRes.text()}`);
    }
  }

  return mediaId;
};
