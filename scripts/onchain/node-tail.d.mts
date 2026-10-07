export interface TailConfig {
  baseUrl: string;
  secret: string;
  chains: string[];
  pollMs: number;
  minGapMs: number;
  intervalMs: number;
  headRpc: (chain: string) => string | null;
}
export interface TailDeps {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (rec: Record<string, unknown>) => void;
}
export function configFromEnv(env?: Record<string, string | undefined>): TailConfig;
export function validate(cfg: TailConfig): string | null;
export function createTail(cfg: TailConfig, deps?: TailDeps): { run: (maxIterations?: number) => Promise<void[]>; stop: () => void };
