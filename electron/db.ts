/// <reference types="node" />
import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { randomUUID } from 'crypto';

// ── 类型定义 ──────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface ConversationWithPreview extends Conversation {
  preview: string;
}

export interface DBMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: number;
}

export interface MemoryFragment {
  id: string;
  conversation_id: string;
  /** 精简摘要文本 */
  content: string;
  /** 本片段归纳的 user+assistant 消息累计偏移终点 */
  msg_offset_end: number;
  created_at: number;
}

// ── 数据库实例 ────────────────────────────────────────────

let db: Database.Database;

// ── 初始化 ────────────────────────────────────────────────

export function initDatabase(): void {
  const dbPath = join(app.getPath('userData'), 'hiyori-chat.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id         TEXT    PRIMARY KEY,
      title      TEXT    NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT    PRIMARY KEY,
      conversation_id TEXT    NOT NULL,
      role            TEXT    NOT NULL,
      content         TEXT    NOT NULL,
      created_at      INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv
      ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_fragments (
      id              TEXT    PRIMARY KEY,
      conversation_id TEXT    NOT NULL,
      content         TEXT    NOT NULL,
      msg_offset_end  INTEGER NOT NULL,
      created_at      INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_memory_conv
      ON memory_fragments(conversation_id, created_at);
  `);
}

// ── Settings 键值存储 ─────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// ── 结构化全局记忆（Hermes 风格分块）──────────────────────

/** 结构化记忆接口（Hermes 风格：USER + MEMORY 双文件） */
export interface StructuredGlobalMemory {
  /** 用户画像（偏好、习惯、沟通风格） */
  user: string[];
  /** 环境配置和工具经验（系统信息、工具特性、项目约定） */
  memory: string[];
}

/** 读取结构化全局记忆（返回条目数组）
 * 【兼容性】如果结构化字段为空，fallback 到旧 global_memory 字段 */
export function getStructuredGlobalMemory(): StructuredGlobalMemory {
  const userRaw = getSetting('global_memory_user');
  const memoryRaw = getSetting('global_memory_main');
  
  const user = userRaw ? userRaw.split('§').map(s => s.trim()).filter(Boolean) : [];
  const memory = memoryRaw ? memoryRaw.split('§').map(s => s.trim()).filter(Boolean) : [];
  
  // 如果结构化字段都为空，fallback 到旧的 global_memory
  if (user.length === 0 && memory.length === 0) {
    const legacy = getSetting('global_memory');
    if (legacy?.trim()) {
      // 将旧记忆临时归入 MEMORY 块（环境配置）
      return { user: [], memory: [legacy.trim()] };
    }
  }
  
  return { user, memory };
}

/** 写入结构化全局记忆（条目数组）
 * 【兼容性】同时更新旧 global_memory 字段，保持 memory tool 可读性 */
export function setStructuredGlobalMemory(data: StructuredGlobalMemory): void {
  setSetting('global_memory_user', data.user.join('§'));
  setSetting('global_memory_main', data.memory.join('§'));
  
  // 同步写入旧字段（memory tool 兼容性）
  const allEntries = [...data.user, ...data.memory];
  setSetting('global_memory', allEntries.join('§'));
}

// ── 对话 CRUD ─────────────────────────────────────────────

export function createConversation(title = '新对话'): Conversation {
  const conv: Conversation = {
    id: randomUUID(),
    title,
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  db.prepare(
    'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'
  ).run(conv.id, conv.title, conv.created_at, conv.updated_at);
  return conv;
}

export function listConversations(): ConversationWithPreview[] {
  return db.prepare(`
    SELECT
      c.*,
      COALESCE(
        (SELECT content FROM messages
         WHERE conversation_id = c.id AND role != 'system'
         ORDER BY created_at DESC LIMIT 1),
        ''
      ) AS preview
    FROM conversations c
    ORDER BY c.updated_at DESC
  `).all() as ConversationWithPreview[];
}

export function renameConversation(id: string, title: string): void {
  db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id);
}

export function deleteConversation(id: string): void {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

// ── 消息 CRUD ─────────────────────────────────────────────

export function getMessages(conversationId: string): DBMessage[] {
  return db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(conversationId) as DBMessage[];
}

export function addMessage(msg: Omit<DBMessage, 'id' | 'created_at'>): DBMessage {
  const full: DBMessage = { ...msg, id: randomUUID(), created_at: Date.now() };
  db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(full.id, full.conversation_id, full.role, full.content, full.created_at);
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
    full.created_at,
    msg.conversation_id
  );
  return full;
}

/**
 * 获取最近 N 轮上下文消息（user + assistant，不含 system），时间升序。
 * N 轮 = 最多 N*2 条消息。
 */
export function getRecentContext(conversationId: string, rounds: number): DBMessage[] {
  const rows = db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = ? AND role != 'system'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(conversationId, rounds * 2) as DBMessage[];
  return rows.reverse();
}

// ── 记忆片段 CRUD ─────────────────────────────────────────

/** 获取一个对话的所有记忆片段，按时间升序（旧 → 新） */
export function getMemoryFragments(conversationId: string): MemoryFragment[] {
  return db.prepare(
    'SELECT * FROM memory_fragments WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(conversationId) as MemoryFragment[];
}

/** 新增一条记忆片段 */
export function addMemoryFragment(
  data: Omit<MemoryFragment, 'id' | 'created_at'>
): MemoryFragment {
  const fragment: MemoryFragment = {
    ...data,
    id: randomUUID(),
    created_at: Date.now(),
  };
  db.prepare(
    'INSERT INTO memory_fragments (id, conversation_id, content, msg_offset_end, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(fragment.id, fragment.conversation_id, fragment.content, fragment.msg_offset_end, fragment.created_at);
  return fragment;
}

/**
 * 统计一个对话中 user + assistant 消息总数（不含 system）。
 * 用于判断是否已积累足够消息触发记忆总结。
 */
export function countNonSystemMessages(conversationId: string): number {
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM messages WHERE conversation_id = ? AND role IN ('user', 'assistant')"
  ).get(conversationId) as { count: number };
  return row.count;
}

/**
 * 按偏移量获取一批 user+assistant 消息（用于送入 LLM 总结）。
 * @param offset - 跳过的消息数（= 已总结游标）
 * @param limit  - 本次获取的消息数（= summaryWindowRounds * 2）
 */
export function getMessagesInRange(
  conversationId: string,
  offset: number,
  limit: number
): DBMessage[] {
  return db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = ? AND role IN ('user', 'assistant')
    ORDER BY created_at ASC
    LIMIT ? OFFSET ?
  `).all(conversationId, limit, offset) as DBMessage[];
}

/** 读取记忆总结游标（已总结到的消息偏移） */
export function getMemoryCursor(conversationId: string): number {
  const val = getSetting(`mem_cursor_${conversationId}`);
  return val ? parseInt(val, 10) : 0;
}

/** 更新记忆总结游标 */
export function setMemoryCursor(conversationId: string, cursor: number): void {
  setSetting(`mem_cursor_${conversationId}`, String(cursor));
}

// ── 全局核心记忆 ──────────────────────────────────────────

/** 读取全局核心记忆文本（不存在时返回 null）【遗留 API，建议迁移到 getStructuredGlobalMemory】 */
export function getGlobalMemory(): string | null {
  return getSetting('global_memory');
}

/** 更新全局核心记忆文本 */
export function setGlobalMemory(content: string): void {
  setSetting('global_memory', content);
}

/**
 * 读取「某对话已有多少条 memory_fragment 被纳入全局记忆」的游标。
 * 用于防止对同一片段重复精炼。
 */
export function getGlobalMemoryCursor(conversationId: string): number {
  const val = getSetting(`global_mem_cursor_${conversationId}`);
  return val ? parseInt(val, 10) : 0;
}

/** 更新全局记忆游标 */
export function setGlobalMemoryCursor(conversationId: string, n: number): void {
  setSetting(`global_mem_cursor_${conversationId}`, String(n));
}
