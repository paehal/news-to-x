/**
 * 共通型定義。
 */
export type CandidateStatus = 'proposed' | 'posted' | 'skipped';

export interface FeedSource {
  title: string;
  url: string;
  category: string;
  language?: string;
}

export interface Article {
  id: string;
  title: string;
  link: string;
  isoDate?: string;
  contentSnippet?: string;
  feedTitle: string;
  category: string;
}

export interface OgMetadata {
  title?: string;
  image?: string;
  url?: string;
}

export interface CandidateMetadata {
  id: number;
  feedTitle: string;
  articleTitle: string;
  url: string;
  category: string;
  comment: string;
  imageBase64: string;
  imageAlt: string;
  imageFileName?: string;
  ogTitle?: string;
  status: CandidateStatus;
  postedAt?: string;
  tweetId?: string;
  rejectionReason?: string;
}

export interface IssueMetadata {
  issueNumber: number | null;
  generatedAt: string;
  timezone: string;
  candidates: CandidateMetadata[];
  runId?: string | null;
}

export interface PostedEntry {
  urlHash: string;
  url: string;
  postedAt: string;
  issueNumber: number | null;
  tweetId?: string;
}

export interface CommentConfig {
  maxChars: number;
}

export type ImageMode = 'publisher_overlay' | 'safe';

export interface ImageOverlayConfig {
  darken: number;
  padding: number;
  maxLines: number;
  fontFamily: string;
  fontWeight: number;
  stroke: boolean;
  dropShadow: boolean;
}

export interface ImageLicenseConfig {
  allowDomains: string[];
  blockDomains: string[];
  minSize: {
    width: number;
    height: number;
  };
}

export interface ImageConfig {
  mode: ImageMode;
  width: number;
  height: number;
  footer: string;
  overlay: ImageOverlayConfig;
  license: ImageLicenseConfig;
}

export interface FilterConfig {
  blockDomains: string[];
  blockWords: string[];
}

export interface AppConfig {
  maxCandidates: number;
  maxPerCategory: number;
  comment: CommentConfig;
  image: ImageConfig;
  filters: FilterConfig;
}

export interface GeneratedCard {
  filePath: string;
  fileName: string;
  base64: string;
  alt: string;
  hash: string;
}
