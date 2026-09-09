import { randomUUID, createHmac, timingSafeEqual, getRandomValues } from 'crypto';
export function generateId(): string { return randomUUID(); }
export function generateHmac(secret: string, data: string): string { return createHmac('sha256', secret).update(data).digest('hex'); }
export function verifyHmac(secret: string, data: string, signature: string): boolean {
  const expected = Buffer.from(generateHmac(secret, data));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
export function generateApiKey(): string {
  const buf = new Uint8Array(32);
  getRandomValues(buf);
  return Buffer.from(buf).toString('hex');
}
