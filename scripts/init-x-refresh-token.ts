import http from 'http';
import crypto from 'crypto';
import { z } from 'zod';
import { fetchWithTimeout } from '../src/utils/fetch.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger('init-x');
const redirectUri = 'http://127.0.0.1:3000/callback';
const scopes = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'];

const TokenResponse = z.object({
  token_type: z.string(),
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  scope: z.string().optional(),
});

const base64url = (buffer: Buffer) =>
  buffer
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

const codeVerifier = base64url(crypto.randomBytes(32));
const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
const state = base64url(crypto.randomBytes(16));

const clientId = process.env.X_CLIENT_ID;
const clientSecret = process.env.X_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  logger.error('X_CLIENT_ID / X_CLIENT_SECRET を環境変数で指定してください。');
  process.exit(1);
}

const authorizeUrl = new URL('https://twitter.com/i/oauth2/authorize');
authorizeUrl.searchParams.set('response_type', 'code');
authorizeUrl.searchParams.set('client_id', clientId);
authorizeUrl.searchParams.set('redirect_uri', redirectUri);
authorizeUrl.searchParams.set('scope', scopes.join(' '));
authorizeUrl.searchParams.set('state', state);
authorizeUrl.searchParams.set('code_challenge', codeChallenge);
authorizeUrl.searchParams.set('code_challenge_method', 'S256');

logger.info('ブラウザで以下の URL を開き、認可後に戻ってきてください。');
logger.info(authorizeUrl.toString());

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith('/callback')) {
    res.writeHead(404).end('Not Found');
    return;
  }
  const requestUrl = new URL(req.url, redirectUri);
  const returnedState = requestUrl.searchParams.get('state');
  const code = requestUrl.searchParams.get('code');
  if (!code || returnedState !== state) {
    res.writeHead(400).end('State mismatch');
    server.close();
    return;
  }

  try {
    const tokenRes = await fetchWithTimeout('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        client_id: clientId,
      }).toString(),
    });
    const rawJson = await tokenRes.json();
    if (!tokenRes.ok) {
      logger.error(`トークン取得に失敗しました: ${JSON.stringify(rawJson)}`);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Failed to obtain token');
      server.close();
      return;
    }
    const tokenJson = TokenResponse.parse(rawJson);
    logger.info(`access_token: ${tokenJson.access_token}`);
    logger.info(`refresh_token: ${tokenJson.refresh_token}`);
    logger.info(`expires_in: ${tokenJson.expires_in}`);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(
      'OK 認可コードを受け取りました。ターミナルを確認してください。',
    );
  } catch (error) {
    logger.error('トークン取得中にエラーが発生しました', error);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Error');
  } finally {
    server.close();
  }
});

server.listen(3000, () => {
  logger.info('http://127.0.0.1:3000/callback で待ち受け中...');
});
