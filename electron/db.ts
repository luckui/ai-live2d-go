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
