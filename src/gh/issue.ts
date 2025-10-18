import { z } from 'zod';
import { IssueMetadata } from '../types.js';
import { createLogger } from '../utils/logger.js';
import { fetchWithTimeout } from '../utils/fetch.js';

const logger = createLogger('gh-issue');
const METADATA_TAG = 'autopost:metadata';

const IssueCreateResponse = z.object({
  number: z.number(),
  html_url: z.string().url(),
});

const IssueGetResponse = z.object({
  number: z.number(),
  html_url: z.string().url(),
  body: z.string().optional(),
});

export const formatIssueTitle = (date: Date): string => {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const formatted = formatter.format(date).replace(/\//g, '-').replace(/\s/g, ' ');
  return `AutoPost 提案 ${formatted}`;
};

export const renderIssueBody = (metadata: IssueMetadata): string => {
  const lines: string[] = [];
  lines.push(`## 候補一覧 (${metadata.generatedAt})`);
  lines.push('');
  lines.push('approve: 1,3 のようにコメントすると該当番号を投稿します。');
  lines.push('');
  for (const candidate of metadata.candidates) {
    const checkbox = candidate.status === 'posted' ? 'x' : ' ';
    lines.push(`- [${checkbox}] ${candidate.id}. ${candidate.feedTitle}｜${candidate.articleTitle}`);
    lines.push(`  - カテゴリ: ${candidate.category}`);
    lines.push(`  - コメント: ${candidate.comment}`);
    lines.push(`  - リンク: ${candidate.url}`);
    if (candidate.tweetId) {
      lines.push(`  - 投稿URL: https://x.com/i/web/status/${candidate.tweetId}`);
    }
    if (candidate.rejectionReason) {
      lines.push(`  - SKIP理由: ${candidate.rejectionReason}`);
    }
    lines.push(`  - 画像: ![候補${candidate.id}](data:image/png;base64,${candidate.imageBase64})`);
    lines.push('');
  }
  lines.push(`<!-- ${METADATA_TAG}`);
  lines.push(JSON.stringify(metadata));
  lines.push('-->');
  return lines.join('\n');
};

export const extractMetadataFromBody = (body?: string | null): IssueMetadata | null => {
  if (!body) {
    return null;
  }
  const regex = new RegExp(`<!--\\s*${METADATA_TAG}\\s*\\n?([\\s\\S]*?)\\s*-->`);
  const match = body.match(regex);
  if (!match) {
    return null;
  }
  try {
    const parsed = JSON.parse(match[1]) as IssueMetadata;
    return parsed;
  } catch (error) {
    logger.error('Issue メタデータの解析に失敗しました', error);
    return null;
  }
};

export interface IssueCreateResult {
  number: number;
  html_url: string;
}

const githubHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'User-Agent': 'news-to-x-bot',
  Accept: 'application/vnd.github+json',
});

export const createProposalIssue = async (
  owner: string,
  repo: string,
  token: string,
  title: string,
  body: string,
): Promise<IssueCreateResult> => {
  const response = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: {
      ...githubHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
      body,
      labels: ['news-proposal'],
    }),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`Issue 作成に失敗しました: ${JSON.stringify(json)}`);
  }
  const data = IssueCreateResponse.parse(json);
  return { number: data.number, html_url: data.html_url };
};

export const updateProposalIssue = async (
  owner: string,
  repo: string,
  token: string,
  issueNumber: number,
  body: string,
): Promise<void> => {
  const response = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: 'PATCH',
    headers: {
      ...githubHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Issue 更新に失敗しました: ${text}`);
  }
};

export const commentOnIssue = async (
  owner: string,
  repo: string,
  token: string,
  issueNumber: number,
  comment: string,
): Promise<void> => {
  const response = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers: {
      ...githubHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body: comment }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Issue コメント投稿に失敗しました: ${text}`);
  }
};

export const fetchIssue = async (
  owner: string,
  repo: string,
  token: string,
  issueNumber: number,
): Promise<{ body: string; number: number; html_url: string }> => {
  const response = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
    headers: githubHeaders(token),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`Issue 取得に失敗しました: ${JSON.stringify(json)}`);
  }
  const data = IssueGetResponse.parse(json);
  return { body: data.body ?? '', number: data.number, html_url: data.html_url };
};

export const parseApprovalComment = (input: string): number[] => {
  const match = input.match(/approve\s*:\s*([0-9,\s]+)/i);
  if (!match) {
    return [];
  }
  return match[1]
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
};
