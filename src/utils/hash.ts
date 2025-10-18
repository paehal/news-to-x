import { createHash } from 'crypto';

export const hashString = (value: string): string => createHash('sha256').update(value).digest('hex');

export const hashBuffer = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex');
