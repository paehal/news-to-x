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

const OverlaySchema = z
  .object({
    darken: z.number().min(0).max(1).default(0.35),
    padding: z.number().int().min(0).default(56),
    maxLines: z.number().int().min(1).max(6).default(3),
    fontFamily: z.string().default('Noto Sans CJK JP'),
    fontWeight: z.number().int().min(100).max(900).default(900),
    stroke: z.boolean().default(true),
    dropShadow: z.boolean().default(true),
  })
  .default({});

const LicenseSchema = z
  .object({
    allowDomains: z.array(z.string()).default([]),
    blockDomains: z.array(z.string()).default([]),
    minSize: z
      .object({
        width: z.number().int().min(1).default(640),
        height: z.number().int().min(1).default(360),
      })
      .default({}),
  })
  .default({});

const ConfigSchema = z.object({
  maxCandidates: z.number().int().min(1).default(5),
  maxPerCategory: z.number().int().min(1).default(2),
  comment: z
    .object({
      maxChars: z.number().int().min(10).max(240).default(38),
    })
    .default({}),
  image: z
    .object({
      mode: z.enum(['publisher_overlay', 'safe']).default('publisher_overlay'),
      width: z.number().int().min(640).max(2400).default(1200),
      height: z.number().int().min(360).max(1350).default(675),
      footer: z.string().default('@news-to-x'),
      overlay: OverlaySchema,
      license: LicenseSchema,
    })
    .default({}),
  filters: FiltersSchema.default({}),
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
