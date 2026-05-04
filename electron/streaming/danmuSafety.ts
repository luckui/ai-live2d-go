import crypto from 'crypto';
import type { LiveEvent, SanitizedLiveEvent } from './types';

const MAX_TEXT = 240;
const MAX_NAME = 32;

const INJECTION_PATTERNS: Array<[RegExp, string]> = [
  [/(system|developer|assistant|tool)\s*:/i, 'role-spoofing'],
  [/(ignore|forget|override).{0,20}(previous|above|instructions|rules)/i, 'instruction-override'],
  [/你现在是|从现在开始|忽略(以上|之前)|系统提示词|开发者消息/, 'cn-instruction-override'],
  [/<\s*(script|iframe|object|embed)\b/i, 'html-script'],
  [/```|<\|.*?\|>|<\/?(system|developer|assistant|tool)>/i, 'prompt-boundary'],
];

function cleanScalar(value: unknown, maxLen: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function sanitizeLiveEvent(event: LiveEvent): SanitizedLiveEvent {
  const text = cleanScalar(event.text, MAX_TEXT);
  const uname = cleanScalar(event.uname || `uid-${event.uid ?? 'unknown'}`, MAX_NAME);
  const giftName = cleanScalar(event.giftName, 40);
  const riskFlags = INJECTION_PATTERNS
    .filter(([pattern]) => pattern.test(text))
    .map(([, flag]) => flag);

  const normalized = text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\p{Script=Han}]+/gu, '')
    .slice(0, 160);

  const fingerprint = crypto
    .createHash('sha1')
    .update(`${event.type}:${event.uid ?? ''}:${normalized}`)
    .digest('hex');

  return {
    ...event,
    uname,
    text,
    giftName,
    fingerprint,
    riskFlags,
  };
}

export function formatUntrustedEvent(event: SanitizedLiveEvent): string {
  const flags = event.riskFlags.length ? ` risk=${event.riskFlags.join(',')}` : '';
  if (event.type === 'gift') {
    return `- [gift${flags}] user=${event.uname} item=${event.giftName} count=${event.giftCount ?? 1} value=${event.giftValue ?? 0}`;
  }
  if (event.type === 'super_chat') {
    return `- [super_chat${flags}] user=${event.uname}: ${event.text}`;
  }
  return `- [${event.type}${flags}] user=${event.uname}: ${event.text}`;
}
