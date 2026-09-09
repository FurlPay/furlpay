export const logger = {
  debug: (msg: string, ctx?: any) => console.debug(JSON.stringify({ level: 'debug', msg, ctx })),
  info: (msg: string, ctx?: any) => console.info(JSON.stringify({ level: 'info', msg, ctx })),
  warn: (msg: string, ctx?: any) => console.warn(JSON.stringify({ level: 'warn', msg, ctx })),
  error: (msg: string, ctx?: any) => console.error(JSON.stringify({ level: 'error', msg, ctx }))
};
