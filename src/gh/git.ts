import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { PostedEntry } from '../types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('git');
const POSTED_PATH = path.resolve(process.cwd(), 'data/posted.json');

export const loadPostedLog = async (): Promise<PostedEntry[]> => {
  try {
    const raw = await fs.readFile(POSTED_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as PostedEntry[];
    }
    logger.warn('data/posted.json の形式が不正です。空配列として扱います。');
    return [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    logger.warn('data/posted.json の読み込みに失敗しました。', error);
    return [];
  }
};

export const savePostedLog = async (entries: PostedEntry[]): Promise<void> => {
  await fs.mkdir(path.dirname(POSTED_PATH), { recursive: true });
  await fs.writeFile(POSTED_PATH, JSON.stringify(entries, null, 2) + '\n', 'utf8');
  if (process.env.GITHUB_ACTIONS === 'true') {
    await commitPostedLogIfChanged();
  }
};

const commitPostedLogIfChanged = async (): Promise<void> => {
  try {
    const status = await runGit(['status', '--porcelain', 'data/posted.json']);
    if (!status.trim()) {
      return;
    }
    await runGit(['config', '--local', 'user.email', 'github-actions[bot]@users.noreply.github.com']);
    await runGit(['config', '--local', 'user.name', 'github-actions[bot]']);
    await runGit(['add', 'data/posted.json']);
    await runGit(['commit', '-m', 'chore: update posted log']);
    await runGit(['push']);
    logger.info('data/posted.json をコミットしました。');
  } catch (error) {
    logger.error('posted.json のコミットに失敗しました', error);
  }
};

const runGit = (args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`git ${args.join(' ')} failed: ${stderr}`));
      }
    });
  });
