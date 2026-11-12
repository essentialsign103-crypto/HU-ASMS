// HU-ASMS: Persistent grammY Session & Conversation Storage Adapters (Critical Blockers Phase C)
import type { StorageAdapter } from 'grammy';
import type { SupabaseClient } from '@hu-asms/database';
import type { SessionData } from '../types/context.js';

const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function cloneSessionJson(value: SessionData): SessionData {
  return JSON.parse(JSON.stringify(value ?? {})) as SessionData;
}

/**
 * Postgres-backed StorageAdapter for grammY `session()` and `@grammyjs/conversations`.
 * Persists multi-step conversation state (`ctx.session.conversation`) across stateless
 * Vercel webhook requests and serverless cold starts via `public.bot_sessions`.
 */
export class SupabaseSessionStorage implements StorageAdapter<SessionData> {
  constructor(
    private client: SupabaseClient,
    private ttlMs: number = DEFAULT_SESSION_TTL_MS
  ) {}

  async read(key: string): Promise<SessionData | undefined> {
    const { data, error } = await this.client
      .from('bot_sessions')
      .select('session_data, expires_at')
      .eq('session_key', key)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to read persistent bot session: ${error.message}`);
    }

    if (!data) {
      return undefined;
    }

    if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
      await this.delete(key).catch(() => {});
      return undefined;
    }

    return cloneSessionJson((data.session_data as SessionData) ?? {});
  }

  async write(key: string, value: SessionData): Promise<void> {
    const now = Date.now();
    const payload = cloneSessionJson(value ?? {});
    const expiresAt = new Date(now + this.ttlMs).toISOString();

    const { error } = await this.client.from('bot_sessions').upsert(
      {
        session_key: key,
        session_data: payload,
        expires_at: expiresAt,
        updated_at: new Date(now).toISOString(),
      },
      { onConflict: 'session_key' }
    );

    if (error) {
      throw new Error(`Failed to persist bot session: ${error.message}`);
    }
  }

  async delete(key: string): Promise<void> {
    const { error } = await this.client
      .from('bot_sessions')
      .delete()
      .eq('session_key', key);

    if (error) {
      throw new Error(`Failed to delete persistent bot session: ${error.message}`);
    }
  }
}

export interface SerializedSessionRecord {
  raw: string;
  expiresAt: number;
}

/**
 * Shared JSON-roundtrip storage helper for unit tests and local non-production development
 * simulating external persistent session stores across bot instance restarts.
 */
export class PersistentMemorySessionStorage implements StorageAdapter<SessionData> {
  constructor(
    private backingMap: Map<string, SerializedSessionRecord> = new Map(),
    private ttlMs: number = DEFAULT_SESSION_TTL_MS
  ) {}

  read(key: string): SessionData | undefined {
    const entry = this.backingMap.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.backingMap.delete(key);
      return undefined;
    }
    return JSON.parse(entry.raw) as SessionData;
  }

  write(key: string, value: SessionData): void {
    this.backingMap.set(key, {
      raw: JSON.stringify(value ?? {}),
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  delete(key: string): void {
    this.backingMap.delete(key);
  }
}
