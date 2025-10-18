import { fetchWithTimeout } from '../utils/fetch.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('x-tweet');

export interface TweetResponse {
  id: string;
  text: string;
}

export const postTweet = async (accessToken: string, text: string, mediaIds: string[]): Promise<TweetResponse> => {
  const response = await fetchWithTimeout('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      media: mediaIds.length ? { media_ids: mediaIds } : undefined,
    }),
  });

  const data = (await response.json()) as { data?: TweetResponse; errors?: unknown };
  if (!response.ok || !data.data) {
    throw new Error(`ツイート投稿に失敗しました: ${JSON.stringify(data)}`);
  }
  logger.info(`ツイート投稿完了: ${data.data.id}`);
  return data.data;
};
