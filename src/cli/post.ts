import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../utils/logger.js';
import { refreshAccessToken } from '../x/oauth2.js';
import { uploadMediaV2 } from '../x/uploadMediaV2.js';
import { uploadMediaV11 } from '../x/uploadMediaV11.js';
import { postTweet } from '../x/postTweet.js';
import { loadPostedLog, savePostedLog } from '../gh/git.js';
import {
  extractMetadataFromBody,
  fetchIssue,
  parseApprovalComment,
  renderIssueBody,
  commentOnIssue,
  updateProposalIssue,
} from '../gh/issue.js';
import { hashString } from '../utils/hash.js';
import { IssueMetadata } from '../types.js';

const logger = createLogger('post');

const main = async () => {
  const args = process.argv.slice(2);
  const manualNumbers = args.filter((arg) => /^[0-9]+$/.test(arg)).map(Number);
  const issueArg = args.find((arg) => arg.startsWith('--issue='));
  let issueNumber: number | null = issueArg ? Number(issueArg.split('=')[1]) : null;

  let approvedNumbers: number[] = manualNumbers;

  if (!approvedNumbers.length) {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
      logger.error('承認番号が与えられていません。CLI から実行する場合は番号を指定してください。');
      process.exit(1);
    }
    const payload = JSON.parse(await fs.readFile(eventPath, 'utf8'));
    const commentBody: string = payload.comment?.body ?? '';
    approvedNumbers = parseApprovalComment(commentBody);
    if (!approvedNumbers.length) {
      logger.info('approve: コメントではないため終了します。');
      return;
    }
    issueNumber = payload.issue?.number ?? null;
    logger.info(`承認コメントを検出: ${approvedNumbers.join(', ')} by ${payload.comment?.user?.login ?? 'unknown'}`);
  }

  approvedNumbers = Array.from(new Set(approvedNumbers)).sort((a, b) => a - b);

  const postedLog = await loadPostedLog();
  const postedHashes = new Set(postedLog.map((entry) => entry.urlHash));

  let metadata: IssueMetadata | null = null;
  let metadataSource: 'issue' | 'local' = 'local';

  const repository = process.env.GITHUB_REPOSITORY ?? '';
  const githubToken = process.env.GITHUB_TOKEN;

  if (issueNumber && githubToken && repository) {
    const [owner, repo] = repository.split('/');
    const issue = await fetchIssue(owner, repo, githubToken, issueNumber);
    metadata = extractMetadataFromBody(issue.body);
    metadataSource = 'issue';
  }

  if (!metadata) {
    const metadataPath = path.resolve(process.cwd(), 'out/latest-metadata.json');
    try {
      const raw = await fs.readFile(metadataPath, 'utf8');
      metadata = JSON.parse(raw) as IssueMetadata;
      logger.warn('Issue メタデータが取得できなかったためローカル out/latest-metadata.json を参照しました。');
    } catch (error) {
      logger.error('候補メタデータを取得できませんでした。', error);
      process.exit(1);
    }
  }

  if (!metadata.issueNumber && issueNumber) {
    metadata.issueNumber = issueNumber;
  } else if (!issueNumber && metadata.issueNumber) {
    issueNumber = metadata.issueNumber;
  }

  const targetCandidates = metadata.candidates.filter((candidate) => approvedNumbers.includes(candidate.id));
  if (!targetCandidates.length) {
    logger.warn('承認された候補が見つかりません。');
    return;
  }

  const refreshTokenValue = process.env.X_REFRESH_TOKEN;
  if (!refreshTokenValue) {
    throw new Error('X_REFRESH_TOKEN が設定されていません。');
  }

  const oauth = await refreshAccessToken(refreshTokenValue);
  const accessToken = oauth.accessToken;

  const mediaStrategy = (process.env.X_MEDIA_STRATEGY ?? 'v2').toLowerCase();

  const results: string[] = [];
  for (const candidate of targetCandidates) {
    const urlHash = hashString(candidate.url);
    if (postedHashes.has(urlHash)) {
      candidate.status = 'skipped';
      candidate.rejectionReason = 'posted-log';
      logger.warn(`既に投稿済みのためスキップ: ${candidate.url}`);
      continue;
    }

    const imageBuffer = Buffer.from(candidate.imageBase64, 'base64');

    let mediaId: string | null = null;
    try {
      if (mediaStrategy === 'v1_1') {
        mediaId = await uploadMediaV11(imageBuffer, candidate.imageAlt);
      } else {
        mediaId = await uploadMediaV2(accessToken, imageBuffer, candidate.imageAlt);
      }
      logger.info(`media_id ${mediaId} を取得しました (候補${candidate.id})`);
    } catch (error) {
      logger.warn(`メディアアップロードに失敗しました。戦略: ${mediaStrategy} / fallback v1.1 を試行`, error);
      try {
        mediaId = await uploadMediaV11(imageBuffer, candidate.imageAlt);
        logger.info(`v1.1 で media_id ${mediaId} を取得しました`);
      } catch (fallbackError) {
        candidate.status = 'skipped';
        candidate.rejectionReason = 'media-upload-failed';
        logger.error(`候補${candidate.id} のメディアアップロードに失敗`, fallbackError);
        continue;
      }
    }

    try {
      const tweet = await postTweet(accessToken, candidate.comment, mediaId ? [mediaId] : []);
      candidate.status = 'posted';
      candidate.tweetId = tweet.id;
      candidate.postedAt = new Date().toISOString();
      postedHashes.add(urlHash);
      postedLog.push({
        urlHash,
        url: candidate.url,
        postedAt: candidate.postedAt,
        issueNumber: metadata.issueNumber ?? null,
        tweetId: tweet.id,
      });
      results.push(`✔️ 候補${candidate.id} を投稿しました https://x.com/i/web/status/${tweet.id}`);
    } catch (error) {
      candidate.status = 'skipped';
      candidate.rejectionReason = 'tweet-failed';
      logger.error(`候補${candidate.id} の投稿に失敗`, error);
    }
  }

  await savePostedLog(postedLog);

  if (issueNumber && githubToken && repository && metadataSource === 'issue') {
    const [owner, repo] = repository.split('/');
    const body = renderIssueBody(metadata);
    await updateProposalIssue(owner, repo, githubToken, issueNumber, body);
    if (results.length) {
      await commentOnIssue(
        owner,
        repo,
        githubToken,
        issueNumber,
        [`承認コメント: ${approvedNumbers.join(', ')}`, ...results].join('\n'),
      );
    }
  }

  const metadataPath = path.resolve(process.cwd(), 'out/latest-metadata.json');
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

  if (!results.length) {
    logger.warn('投稿に成功した候補はありませんでした。');
  } else {
    logger.info('承認候補の投稿処理が完了しました。');
  }
};

main().catch((error) => {
  const log = createLogger('post');
  log.error('post コマンドで致命的なエラーが発生しました', error);
  process.exitCode = 1;
});
