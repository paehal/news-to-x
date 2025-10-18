import { fetchWithTimeout } from '../utils/fetch.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('gh-label');

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'User-Agent': 'news-to-x-bot',
  Accept: 'application/vnd.github+json',
});

export const ensureNewsProposalLabel = async (owner: string, repo: string, token: string): Promise<void> => {
  const url = `https://api.github.com/repos/${owner}/${repo}/labels/news-proposal`;
  const response = await fetchWithTimeout(url, { headers: headers(token) });
  if (response.status === 200) {
    return;
  }
  if (response.status !== 404) {
    const body = await response.text();
    throw new Error(`news-proposal ラベル取得に失敗しました: ${body}`);
  }
  const createRes = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}/labels`, {
    method: 'POST',
    headers: {
      ...headers(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'news-proposal',
      color: '8c8c8c',
      description: 'ニュース自動投稿のレビュー用候補',
    }),
  });
  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`news-proposal ラベル作成に失敗しました: ${body}`);
  }
  logger.info('news-proposal ラベルを新規作成しました。');
};
