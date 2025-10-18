export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const envLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info';
const minLevel = levelPriority[envLevel] ?? levelPriority.info;

const jstFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export const createLogger = (scope: string) => {
  const print = (level: LogLevel, message: string, extra?: unknown) => {
    if (levelPriority[level] < minLevel) {
      return;
    }
    const time = jstFormatter.format(new Date());
    const line = `[${time}] [${scope}] [${level.toUpperCase()}] ${message}`;
    if (extra !== undefined) {
      const method = level === 'error' ? 'error' : 'log';
      console[method](line, extra);
    } else {
      const method = level === 'error' ? 'error' : 'log';
      console[method](line);
    }
  };

  return {
    debug: (message: string, extra?: unknown) => print('debug', message, extra),
    info: (message: string, extra?: unknown) => print('info', message, extra),
    warn: (message: string, extra?: unknown) => print('warn', message, extra),
    error: (message: string, extra?: unknown) => print('error', message, extra),
    scope,
  };
};
