import OpenAI from 'openai';
import { AppConfig, Article } from '../types.js';
import { createLogger } from '../utils/logger.js';
import { normalizeWhitespace, clipByLength } from '../utils/text.js';

const logger = createLogger('comment');

let cachedClient: OpenAI | null = null;

const getClient = (): OpenAI => {
  if (cachedClient) {
    return cachedClient;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY が設定されていません。');
  }
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
};

const openaiModel = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

export const generateComment = async (article: Article, config: AppConfig, ogTitle?: string | null): Promise<string> => {
  const client = getClient();
  const prompt = [
    '以下のニュースについて、日本語で最大38文字の短いコメントを出力してください。',
    '制約:',
    '1. 中立～共感トーンで断定しすぎない。',
    '2. 政治的煽動、誹謗中傷、差別語を避ける。',
    '3. 誤情報になり得る断定は避け、事実ベースで含意を示唆する。',
    '4. 絵文字は1つまで（無くても可）。',
    '',
    `媒体: ${article.feedTitle}`,
    `タイトル: ${article.title}`,
  ];
  if (ogTitle && ogTitle !== article.title) {
    prompt.push(`OGタイトル: ${ogTitle}`);
  }
  if (article.contentSnippet) {
    prompt.push(`概要: ${article.contentSnippet.slice(0, 400)}`);
  }

  logger.debug(`OpenAI へコメント生成を依頼: ${article.title}`);
  const response = await client.responses.create({
    model: openaiModel,
    input: [
      {
        role: 'system',
        content: 'あなたは慎重な日本語ニュース編集者です。安全で節度のある一言コメントのみを返答します。',
      },
      { role: 'user', content: prompt.join('\n') },
    ],
    temperature: 0.6,
    max_output_tokens: 120,
  });

  const rawText = normalizeWhitespace(response.output_text ?? '');
  const clipped = clipByLength(rawText, config.comment.maxChars);
  if (!clipped) {
    throw new Error('生成コメントが空文字でした。');
  }

  const moderation = await client.moderations.create({
    model: 'omni-moderation-latest',
    input: clipped,
  });
  const flagged = moderation.results?.some((result) => result.flagged);
  if (flagged) {
    logger.warn(`モデレーションで除外: ${clipped}`);
    throw new Error('コメントがモデレーション判定でブロックされました。');
  }

  return clipped;
};
