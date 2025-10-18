import { spawn } from 'child_process';
import { fetchWithTimeout } from '../utils/fetch.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('x-oauth');

export interface RefreshTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: string;
}

export const refreshAccessToken = async (refreshToken: string): Promise<RefreshTokenResult> => {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('X_CLIENT_ID / X_CLIENT_SECRET が設定されていません。');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const response = await fetchWithTimeout('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: body.toString(),
  });

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    error?: unknown;
  };

  if (!response.ok || !data.access_token) {
    throw new Error(`トークンリフレッシュに失敗しました: ${JSON.stringify(data)}`);
  }

  if (data.refresh_token && data.refresh_token !== refreshToken) {
    await persistNewRefreshToken(data.refresh_token);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
  };
};

const persistNewRefreshToken = async (newRefreshToken: string) => {
  const ghPat = process.env.GH_PAT;
  const repository = process.env.GITHUB_REPOSITORY;

  if (!ghPat || !repository) {
    logger.warn('X_REFRESH_TOKEN のローテーションを検出しましたが GH_PAT / GITHUB_REPOSITORY が無いため Secrets 更新をスキップします。');
    return;
  }

  await runGhCommand(['secret', 'set', 'X_REFRESH_TOKEN', '--body', newRefreshToken, '--repo', repository], {
    env: {
      ...process.env,
      GITHUB_TOKEN: ghPat,
    },
  });
  logger.info('GitHub Secrets の X_REFRESH_TOKEN を更新しました。');
};

const runGhCommand = (args: string[], options: { env: NodeJS.ProcessEnv }) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn('gh', args, {
      stdio: 'inherit',
      env: options.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`gh コマンドが失敗しました (exit ${code})`));
      }
    });
  });
