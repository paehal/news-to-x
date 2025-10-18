const segmenter =
  typeof (Intl as typeof Intl & { Segmenter?: typeof Intl.Segmenter }).Segmenter === 'function'
    ? new Intl.Segmenter('ja', { granularity: 'grapheme' })
    : null;

/**
 * 余分な空白を除去して単純化する。
 */
export const normalizeWhitespace = (input: string): string => input.replace(/\s+/g, ' ').trim();

/**
 * 文字数上限を超える場合は三点リーダで丸める。
 */
export const clipByLength = (input: string, maxChars: number): string => {
  const chars = Array.from(input);
  if (chars.length <= maxChars) {
    return input;
  }
  if (maxChars <= 1) {
    return chars.slice(0, maxChars).join('');
  }
  return `${chars.slice(0, maxChars - 1).join('')}…`;
};

/**
 * SVG 用の簡易改行。最大文字数を超えると折り返す。
 */
export const wrapJapaneseText = (input: string, maxChars: number): string[] => {
  const text = normalizeWhitespace(input);
  if (!text) {
    return [''];
  }
  const result: string[] = [];
  let current = '';

  const tokens = segmenter ? Array.from(segmenter.segment(text)).map((seg) => seg.segment) : Array.from(text);

  for (const token of tokens) {
    const tentative = current + token;
    if (Array.from(tentative).length > maxChars && current) {
      result.push(current);
      current = token;
    } else {
      current = tentative;
    }
  }

  if (current) {
    result.push(current);
  }

  return result.length ? result : [''];
};

/**
 * NG ワードを含むか判定。
 */
export const containsBlockedWord = (input: string, blockedWords: string[]): string | null => {
  const normalized = normalizeWhitespace(input);
  for (const word of blockedWords) {
    const trimmed = word.trim();
    if (trimmed && normalized.includes(trimmed)) {
      return trimmed;
    }
  }
  return null;
};

/**
 * ファイル名に利用できる安全な文字列を返す。
 */
export const toSafeFileName = (input: string): string => {
  const replaced = normalizeWhitespace(input).replace(/[\\/:*?"<>|]/g, '-');
  return replaced.toLowerCase().replace(/\s+/g, '-').slice(0, 40);
};
