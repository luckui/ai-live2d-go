export type LivePlatform = 'bilibili';

export type LiveEventType =
  | 'danmu'
  | 'gift'
  | 'super_chat'
  | 'guard'
  | 'enter'
  | 'like'
  | 'system';

export interface LiveEvent {
  id: string;
  platform: LivePlatform;
  type: LiveEventType;
  ts: number;
  uid?: string;
  uname?: string;
  text?: string;
  giftName?: string;
  giftCount?: number;
  giftValue?: number;
  raw?: unknown;
}

export interface SanitizedLiveEvent extends Omit<LiveEvent, 'text' | 'uname' | 'giftName'> {
  uname: string;
  text: string;
  giftName: string;
  fingerprint: string;
  riskFlags: string[];
}

export interface StreamerSessionConfig {
  platform: LivePlatform;
  roomId: number;
  topic?: string;
  conversationId?: string;
  autoReply?: boolean;
}

export interface EphemeralLiveCredentials {
  cookie: string;
  receivedAt: number;
}

export interface StreamerReply {
  id: string;
  createdAt: number;
  kind: 'gift_thanks' | 'danmu_single' | 'danmu_batch' | 'topic_control';
  prompt: string;
  reply?: string;
  eventIds: string[];
}

export interface StreamerStatus {
  running: boolean;
  platform?: LivePlatform;
  roomId?: number;
  topic?: string;
  startedAt?: number;
  adapterStatus?: string;
  credentials: {
    required: boolean;
    present: boolean;
    persisted: false;
  };
  queue: {
    pendingDanmu: number;
    pendingPriority: number;
    recentPerMinute: number;
    mode: 'single' | 'batch' | 'summary';
  };
  replies: number;
  lastError?: string;
}
