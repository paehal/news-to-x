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

const resolveBranch = (): string | null => {
  if (process.env.GITHUB_REF_NAME) {
    return process.env.GITHUB_REF_NAME;
  }
  const ref = process.env.GITHUB_REF;
  if (ref?.startsWith('refs/heads/')) {
    return ref.replace('refs/heads/', '');
  }
  return null;
};

const buildImageMarkdown = (metadata: IssueMetadata, candidate: IssueMetadata['candidates'][number], index: number): string[] => {
  const runId = metadata.runId;
  const ownerRepo = process.env.GITHUB_REPOSITORY;
  const branch = resolveBranch();
  if (!runId || !ownerRepo || !branch || !candidate.imageFileName) {
    return [];
  }
  const base = `https://raw.githubusercontent.com/${ownerRepo}/${branch}`;
  const imagePath = `cards/${runId}/${candidate.imageFileName}`;
  const url = `${base}/${imagePath}`;
  return [
    `![カード ${index + 1}](${url})`,
    `[カード画像を開く](${url})`,
  ];
};

const buildCompactBody = (metadata: IssueMetadata): string => {
  const header = ['# AutoPost 候補', 'コメントで `approve: 1,3` のように番号を指定してください。'];
  const sections = metadata.candidates.map((candidate, index) => {
    const lines = [
      `## 候補 ${index + 1}`,
      `媒体: ${candidate.feedTitle}`,
      `カテゴリ: ${candidate.category}`,
      `コメント: **${candidate.comment}**`,
      candidate.articleTitle,
      `[記事リンク](${candidate.url})`,
    ];
    lines.push(...buildImageMarkdown(metadata, candidate, index));
    if (candidate.tweetId) {
      lines.push(`投稿URL: https://x.com/i/web/status/${candidate.tweetId}`);
    }
    if (candidate.rejectionReason) {
      lines.push(`SKIP理由: ${candidate.rejectionReason}`);
    }
    return lines.join('\n');
  });
  return [...header, ...sections, `<!-- ${METADATA_TAG}\n${JSON.stringify(metadata)}\n-->`].join('\n\n');
};

export const renderIssueBody = (metadata: IssueMetadata): string => buildCompactBody(metadata);

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
