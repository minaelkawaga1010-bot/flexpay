/* eslint-disable no-console */
type LogContext = Record<string, unknown>;

const fmt = (level: string, msg: string, ctx?: LogContext) =>
  ctx ? `[${level}] ${msg} ${JSON.stringify(ctx)}` : `[${level}] ${msg}`;

const logger = {
  info: (msg: string, ctx?: LogContext) => console.log(fmt('info', msg, ctx)),
  warn: (msg: string, ctx?: LogContext) => console.warn(fmt('warn', msg, ctx)),
  error: (msg: string, ctx?: LogContext) => console.error(fmt('error', msg, ctx)),
  debug: (msg: string, ctx?: LogContext) => {
    if (__DEV__) console.log(fmt('debug', msg, ctx));
  },
};

export default logger;
