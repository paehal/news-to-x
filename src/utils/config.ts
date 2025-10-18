import path from 'path';
import fs from 'fs/promises';
import yaml from 'yaml';
import { z } from 'zod';
import { AppConfig } from '../types.js';
import { createLogger } from './logger.js';

const logger = createLogger('config');

const FiltersSchema = z.object({
  blockDomains: z.array(z.string()).default([]),
  blockWords: z.array(z.string()).default([]),
});

const ConfigSchema = z.object({
  maxCandidates: z.number().int().min(1).default(5),
  maxPerCategory: z.number().int().min(1).default(2),
  comment: z
    .object({
      maxChars: z.number().int().min(10).max(120).default(38),
    })
    .default({}),
  image: z
    .object({
      width: z.number().int().min(640).max(2400).default(1200),
      height: z.number().int().min(360).max(1350).default(675),
      footer: z.string().default('@news-to-x'),
    })
    .default({}),
  filters: FiltersSchema.default({}),
  usePublisherImage: z.boolean().default(false),
});

export const CONFIG_PATH = path.resolve(process.cwd(), 'config.yml');

let cachedConfig: AppConfig | null = null;

export const loadConfig = async (): Promise<AppConfig> => {
  if (cachedConfig) {
    return cachedConfig;
  }
  let loaded: unknown;
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    loaded = yaml.parse(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.warn('config.yml が見つからなかったため既定値を使用します。');
      loaded = {};
    } else {
      throw error;
    }
  }
  const parsed = ConfigSchema.parse(loaded);
  cachedConfig = parsed;
  return parsed;
};
