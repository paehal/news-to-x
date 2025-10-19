import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';
import { loadFeedSources, fetchLatestArticles } from '../news/fetchFeeds.js';
import { extractOgMetadata, resolvePublisherImage } from '../news/extractOg.js';
import { generateComment } from '../nlp/comment.js';
import { generateSafeCard, makePublisherOverlayCard } from '../image/makeCard.js';
import { ensureNewsProposalLabel } from '../gh/labels.js';
import { createProposalIssue, updateProposalIssue, renderIssueBody, formatIssueTitle } from '../gh/issue.js';
import { loadPostedLog } from '../gh/git.js';
import { containsBlockedWord } from '../utils/text.js';
import { CandidateMetadata, ImageFailure, IssueMetadata } from '../types.js';

const logger = createLogger('collect');

const formatIso = (date: Date) => date.toISOString();

const main = async () => {
  logger.info('候補生成処理を開始します。');
  const config = await loadConfig();
  const postedLog = await loadPostedLog();
  const postedHashes = new Set(postedLog.map((entry) => entry.urlHash));
  const runId = process.env.GITHUB_RUN_ID ?? null;

  const feeds = await loadFeedSources();
  logger.info(`RSS ソース数: ${feeds.length}`);

  const articles = await fetchLatestArticles(feeds, config, postedHashes);

  if (!articles.length) {
    logger.info('新規候補が見つかりませんでした。');
    return;
  }

  const outDir = path.resolve(process.cwd(), 'out');
  await fs.mkdir(outDir, { recursive: true });

  const candidates: CandidateMetadata[] = [];
  const imageFailures: ImageFailure[] = [];
  for (const article of articles) {
    const blocked = containsBlockedWord(`${article.title} ${article.contentSnippet ?? ''}`, config.filters.blockWords);
    if (blocked) {
      logger.info(`ブロックワード(${blocked})で除外: ${article.title}`);
      continue;
    }

    try {
      const og = await extractOgMetadata(article.link);
      const comment = await generateComment(article, config, og?.title);

      if (config.image.mode === 'publisher_overlay') {
        if (!og?.image) {
          imageFailures.push({
            feedTitle: article.feedTitle,
            articleTitle: article.title,
            url: article.link,
            reason: 'og-image-missing',
          });
          logger.warn(`OG 画像が取得できなかったため候補をスキップします: ${article.title}`);
          continue;
        }

        let publisherImage = null;
        try {
          publisherImage = await resolvePublisherImage(article.link, og.image, config.image.license);
        } catch (error) {
          const reason = (error as Error)?.message ?? 'resolve-failed';
          imageFailures.push({
            feedTitle: article.feedTitle,
            articleTitle: article.title,
            url: article.link,
            reason,
          });
          logger.warn(`OG 画像の利用ができませんでした (${reason}): ${article.title}`);
          continue;
        }

        try {
          const card = await makePublisherOverlayCard({
            index: candidates.length + 1,
            comment,
            articleTitle: article.title,
            publisher: article.feedTitle,
            footer: config.image.footer,
            outputDir: outDir,
            width: config.image.width,
            height: config.image.height,
            overlay: config.image.overlay,
            imageBuffer: publisherImage.buffer,
          });

          candidates.push({
            id: candidates.length + 1,
            feedTitle: article.feedTitle,
            articleTitle: article.title,
            url: article.link,
            category: article.category,
            comment,
            imageBase64: card.base64,
            imageAlt: card.alt,
            imageFileName: card.fileName,
            ogTitle: og?.title,
            status: 'proposed',
          });
          logger.info(`候補 ${candidates.length} を追加: ${article.title}`);
        } catch (error) {
        const msg = (error as Error)?.message ?? 'overlay-failed';
        imageFailures.push({
          feedTitle: article.feedTitle,
          articleTitle: article.title,
          url: article.link,
          reason: `overlay-failed:${msg}`,
        });
        logger.error(`publisher overlay failed: ${article.title}`, error);
      }
      continue;
      }

      const safeCard = await generateSafeCard({
        index: candidates.length + 1,
        articleTitle: article.title,
        publisher: article.feedTitle,
        comment,
        link: article.link,
        outputDir: outDir,
        config,
      });

      candidates.push({
        id: candidates.length + 1,
        feedTitle: article.feedTitle,
        articleTitle: article.title,
        url: article.link,
        category: article.category,
        comment,
        imageBase64: safeCard.base64,
        imageAlt: safeCard.alt,
        imageFileName: safeCard.fileName,
        ogTitle: og?.title,
        status: 'proposed',
      });
      logger.info(`候補 ${candidates.length} を追加: ${article.title}`);
    } catch (error) {
      logger.error(`候補生成に失敗しました: ${article.title}`, error);
    }
  }

  if (!candidates.length) {
    logger.warn('候補を生成できませんでした。');
    return;
  }

  const metadata: IssueMetadata = {
    issueNumber: null,
    generatedAt: formatIso(new Date()),
    timezone: 'Asia/Tokyo',
    candidates,
    runId,
    imageFailures: imageFailures.length ? imageFailures : undefined,
  };

  const metadataPath = path.join(outDir, 'latest-metadata.json');
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  logger.info(`ローカルメタデータを保存しました: ${metadataPath}`);

  const githubToken = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;

  if (!githubToken || !repository) {
    logger.warn('GITHUB_TOKEN または GITHUB_REPOSITORY が無いため Issue 生成をスキップしました。');
    return;
  }

  const [owner, repo] = repository.split('/');
  await ensureNewsProposalLabel(owner, repo, githubToken);

  const title = formatIssueTitle(new Date());
  const body = renderIssueBody(metadata);
  const issue = await createProposalIssue(owner, repo, githubToken, title, body);

  metadata.issueNumber = issue.number;
  const updatedBody = renderIssueBody(metadata);
  await updateProposalIssue(owner, repo, githubToken, issue.number, updatedBody);
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

  logger.info(`Issue #${issue.number} を作成しました: ${issue.html_url}`);
  logger.info('候補生成処理を完了しました。');
};

main().catch((error) => {
  const log = createLogger('collect');
  log.error('collect コマンドで致命的なエラーが発生しました', error);
  process.exitCode = 1;
});
