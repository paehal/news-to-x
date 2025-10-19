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

const openaiModel = process.env.OPENAI_MODEL ?? 'gpt-4o';

export const generateComment = async (article: Article, config: AppConfig, ogTitle?: string | null): Promise<string> => {
  const client = getClient();
  const prompt = [
    `記事を読んで、その記事内の画像について、端的に日本語熟語やカタカナ言葉などの短いうまい言葉ででそのニュースのサムネイルにタイトルをつけてください。できるだけ辛辣で皮肉をたっぷり含んだユーモアのある感じでお願いします。想定してほしいのは、このサムネイル画像にこのタイトル文字をドンと真ん中に書いてそれだけをみた読者が面白いとか興味を惹かせないといけないわけです。方法として例えばニュースの中の題材を2つうまくまぜでそれならではの用語にした欲しいんですよね。 5つくらい案を出すようにしてください。
画像に写る要素A×ニュース行動Bを掛け合わせた新語を5案。2–6文字／カタカナ可、既存慣用句は禁止。各案に10字以内の理由（何と何を掛けたか）を添える。
トーンは 辛辣＞皮肉＞ユーモア、サムネ単体で意味が通ること。そのニュースをメタ的な俯瞰視点で言い表す言葉を考えてほしいんだよね。`,
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
        content: '記事を読んで、その記事内の画像について、端的に日本語熟語やカタカナ言葉などの短いうまい言葉ででそのニュースのサムネイルにタイトルをつけてください。できるだけ辛辣で皮肉をたっぷり含んだユーモアのある感じでお願いします。想定してほしいのは、このサムネイル画像にこのタイトル文字をドンと真ん中に書いてそれだけをみた読者が面白いとか興味を惹かせないといけないわけです。方法として例えばニュースの中の題材を2つうまくまぜでそれならではの用語にした欲しいんですよね。 5つくらい案を出すようにしてください。画像に写る要素A×ニュース行動Bを掛け合わせた新語を5案。2–6文字／カタカナ可、既存慣用句は禁止。各案に10字以内の理由（何と何を掛けたか）を添える。トーンは 辛辣＞皮肉＞ユーモア、サムネ単体で意味が通ること。そのニュースをメタ的な俯瞰視点で言い表す言葉を考えてほしいんだよね。',
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
