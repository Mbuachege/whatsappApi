import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import logger from '../utils/logger'

export interface AdminUser {
  id: number
  username: string
  password_hash: string
  salt: string
  created_at: string
  last_login: string | null
}

export interface Application {
  id: string
  name: string
  description: string
  webhook_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ApiKey {
  id: string
  app_id: string
  key_prefix: string
  key_hash: string
  name: string
  is_active: boolean
  last_used_at: string | null
  created_at: string
  expires_at: string | null
}

export interface WhatsAppSession {
  id: string
  app_id: string | null
  phone_number: string | null
  label: string
  status: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AdminSession {
  id: string
  admin_id: number
  token: string
  expires_at: string
  created_at: string
}

/**
 * Central database manager for the WhatsApp API Gateway
 * Handles admin users, applications, API keys, and WhatsApp sessions
 */
export class AppDatabase {
  private db: Database.Database
  private static instance: AppDatabase | null = null

  constructor(dataPath: string) {
    if (!fs.existsSync(dataPath)) {
      fs.mkdirSync(dataPath, { recursive: true })
    }

    const dbPath = path.join(dataPath, 'gateway.db')
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('foreign_keys = ON')

    this.initializeTables()
    logger.info(`Gateway database initialized at ${dbPath}`)
  }

  static getInstance(dataPath?: string): AppDatabase {
    if (!AppDatabase.instance) {
      if (!dataPath) throw new Error('dataPath required for first initialization')
      AppDatabase.instance = new AppDatabase(dataPath)
    }
    return AppDatabase.instance
  }

  getDb(): Database.Database {
    return this.db
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME
      );

      CREATE TABLE IF NOT EXISTS admin_sessions (
        id TEXT PRIMARY KEY,
        admin_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS applications (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        webhook_url TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        name TEXT DEFAULT 'Default',
        is_active INTEGER DEFAULT 1,
        last_used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS whatsapp_sessions (
        id TEXT PRIMARY KEY,
        app_id TEXT,
        phone_number TEXT,
        label TEXT NOT NULL,
        status TEXT DEFAULT 'disconnected',
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_api_keys_app ON api_keys(app_id);
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
      CREATE INDEX IF NOT EXISTS idx_sessions_app ON whatsapp_sessions(app_id);
      CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token);
    `)
  }

  // ===== Password Hashing =====

  hashPassword(password: string, salt?: string): { hash: string; salt: string } {
    const s = salt || crypto.randomBytes(32).toString('hex')
    const hash = crypto.scryptSync(password, s, 64).toString('hex')
    return { hash, salt: s }
  }

  verifyPassword(password: string, hash: string, salt: string): boolean {
    const result = this.hashPassword(password, salt)
    return result.hash === hash
  }

  // ===== Admin Users =====

  createAdmin(username: string, password: string): AdminUser {
    const { hash, salt } = this.hashPassword(password)
    const stmt = this.db.prepare(`
      INSERT INTO admin_users (username, password_hash, salt)
      VALUES (?, ?, ?)
    `)
    const result = stmt.run(username, hash, salt)
    return this.getAdminById(result.lastInsertRowid as number)!
  }

  getAdminByUsername(username: string): AdminUser | null {
    const stmt = this.db.prepare('SELECT * FROM admin_users WHERE username = ?')
    return (stmt.get(username) as AdminUser) || null
  }

  getAdminById(id: number): AdminUser | null {
    const stmt = this.db.prepare('SELECT * FROM admin_users WHERE id = ?')
    return (stmt.get(id) as AdminUser) || null
  }

  updateAdminLogin(id: number): void {
    const stmt = this.db.prepare('UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?')
    stmt.run(id)
  }

  changeAdminPassword(id: number, newPassword: string): void {
    const { hash, salt } = this.hashPassword(newPassword)
    const stmt = this.db.prepare('UPDATE admin_users SET password_hash = ?, salt = ? WHERE id = ?')
    stmt.run(hash, salt, id)
  }

  hasAdminUsers(): boolean {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM admin_users')
    const row = stmt.get() as any
    return row.count > 0
  }

  // ===== Admin Sessions =====

  createAdminSession(adminId: number): { token: string; expiresAt: string } {
    const id = crypto.randomUUID()
    const token = crypto.randomBytes(48).toString('base64url')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    const stmt = this.db.prepare(`
      INSERT INTO admin_sessions (id, admin_id, token, expires_at)
      VALUES (?, ?, ?, ?)
    `)
    stmt.run(id, adminId, token, expiresAt)

    return { token, expiresAt }
  }

  validateAdminSession(token: string): AdminUser | null {
    const stmt = this.db.prepare(`
      SELECT au.* FROM admin_sessions as2
      JOIN admin_users au ON au.id = as2.admin_id
      WHERE as2.token = ? AND as2.expires_at > datetime('now')
    `)
    return (stmt.get(token) as AdminUser) || null
  }

  deleteAdminSession(token: string): void {
    const stmt = this.db.prepare('DELETE FROM admin_sessions WHERE token = ?')
    stmt.run(token)
  }

  cleanExpiredSessions(): void {
    const stmt = this.db.prepare("DELETE FROM admin_sessions WHERE expires_at <= datetime('now')")
    stmt.run()
  }

  // ===== Applications =====

  createApplication(name: string, description: string = '', webhookUrl: string | null = null): Application {
    const id = crypto.randomUUID()
    const stmt = this.db.prepare(`
      INSERT INTO applications (id, name, description, webhook_url)
      VALUES (?, ?, ?, ?)
    `)
    stmt.run(id, name, description, webhookUrl)
    return this.getApplication(id)!
  }

  getApplication(id: string): Application | null {
    const stmt = this.db.prepare('SELECT * FROM applications WHERE id = ?')
    const row = stmt.get(id) as any
    if (!row) return null
    return { ...row, is_active: Boolean(row.is_active) }
  }

  listApplications(): Application[] {
    const stmt = this.db.prepare('SELECT * FROM applications ORDER BY created_at DESC')
    return (stmt.all() as any[]).map(row => ({ ...row, is_active: Boolean(row.is_active) }))
  }

  updateApplication(id: string, updates: Partial<Pick<Application, 'name' | 'description' | 'webhook_url' | 'is_active'>>): Application | null {
    const fields: string[] = []
    const values: any[] = []

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description) }
    if (updates.webhook_url !== undefined) { fields.push('webhook_url = ?'); values.push(updates.webhook_url) }
    if (updates.is_active !== undefined) { fields.push('is_active = ?'); values.push(updates.is_active ? 1 : 0) }

    if (fields.length === 0) return this.getApplication(id)

    fields.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)

    const stmt = this.db.prepare(`UPDATE applications SET ${fields.join(', ')} WHERE id = ?`)
    stmt.run(...values)
    return this.getApplication(id)
  }

  deleteApplication(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM applications WHERE id = ?')
    const result = stmt.run(id)
    return result.changes > 0
  }

  // ===== API Keys =====

  generateApiKey(appId: string, name: string = 'Default', expiresInDays: number | null = null): { apiKey: string; record: ApiKey } {
    const id = crypto.randomUUID()
    const rawKey = `wag_${crypto.randomBytes(32).toString('base64url')}`
    const keyPrefix = rawKey.substring(0, 12)
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex')

    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null

    const stmt = this.db.prepare(`
      INSERT INTO api_keys (id, app_id, key_prefix, key_hash, name, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    stmt.run(id, appId, keyPrefix, keyHash, name, expiresAt)

    const record = this.getApiKeyById(id)!
    return { apiKey: rawKey, record }
  }

  validateApiKey(rawKey: string): { app: Application; key: ApiKey } | null {
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex')
    const stmt = this.db.prepare(`
      SELECT ak.*, a.name as app_name, a.is_active as app_is_active
      FROM api_keys ak
      JOIN applications a ON a.id = ak.app_id
      WHERE ak.key_hash = ?
        AND ak.is_active = 1
        AND a.is_active = 1
        AND (ak.expires_at IS NULL OR ak.expires_at > datetime('now'))
    `)
    const row = stmt.get(keyHash) as any
    if (!row) return null

    this.db.prepare('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id)

    const app = this.getApplication(row.app_id)!
    const key: ApiKey = {
      id: row.id,
      app_id: row.app_id,
      key_prefix: row.key_prefix,
      key_hash: row.key_hash,
      name: row.name,
      is_active: Boolean(row.is_active),
      last_used_at: row.last_used_at,
      created_at: row.created_at,
      expires_at: row.expires_at,
    }

    return { app, key }
  }

  getApiKeyById(id: string): ApiKey | null {
    const stmt = this.db.prepare('SELECT * FROM api_keys WHERE id = ?')
    const row = stmt.get(id) as any
    if (!row) return null
    return { ...row, is_active: Boolean(row.is_active) }
  }

  listApiKeys(appId: string): ApiKey[] {
    const stmt = this.db.prepare('SELECT * FROM api_keys WHERE app_id = ? ORDER BY created_at DESC')
    return (stmt.all(appId) as any[]).map(row => ({ ...row, is_active: Boolean(row.is_active) }))
  }

  revokeApiKey(id: string): boolean {
    const stmt = this.db.prepare('UPDATE api_keys SET is_active = 0 WHERE id = ?')
    return stmt.run(id).changes > 0
  }

  deleteApiKey(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM api_keys WHERE id = ?')
    return stmt.run(id).changes > 0
  }

  // ===== WhatsApp Sessions =====

  createWhatsAppSession(label: string, appId: string | null = null): WhatsAppSession {
    const id = crypto.randomUUID()
    const stmt = this.db.prepare(`
      INSERT INTO whatsapp_sessions (id, app_id, label)
      VALUES (?, ?, ?)
    `)
    stmt.run(id, appId, label)
    return this.getWhatsAppSession(id)!
  }

  getWhatsAppSession(id: string): WhatsAppSession | null {
    const stmt = this.db.prepare('SELECT * FROM whatsapp_sessions WHERE id = ?')
    const row = stmt.get(id) as any
    if (!row) return null
    return { ...row, is_active: Boolean(row.is_active) }
  }

  listWhatsAppSessions(): WhatsAppSession[] {
    const stmt = this.db.prepare(`
      SELECT ws.*, a.name as app_name
      FROM whatsapp_sessions ws
      LEFT JOIN applications a ON a.id = ws.app_id
      ORDER BY ws.created_at DESC
    `)
    return (stmt.all() as any[]).map(row => ({ ...row, is_active: Boolean(row.is_active) }))
  }

  updateWhatsAppSession(id: string, updates: Partial<Pick<WhatsAppSession, 'phone_number' | 'status' | 'is_active' | 'app_id' | 'label'>>): WhatsAppSession | null {
    const fields: string[] = []
    const values: any[] = []

    if (updates.phone_number !== undefined) { fields.push('phone_number = ?'); values.push(updates.phone_number) }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
    if (updates.is_active !== undefined) { fields.push('is_active = ?'); values.push(updates.is_active ? 1 : 0) }
    if (updates.app_id !== undefined) { fields.push('app_id = ?'); values.push(updates.app_id) }
    if (updates.label !== undefined) { fields.push('label = ?'); values.push(updates.label) }

    if (fields.length === 0) return this.getWhatsAppSession(id)

    fields.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)

    const stmt = this.db.prepare(`UPDATE whatsapp_sessions SET ${fields.join(', ')} WHERE id = ?`)
    stmt.run(...values)
    return this.getWhatsAppSession(id)
  }

  deleteWhatsAppSession(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM whatsapp_sessions WHERE id = ?')
    return stmt.run(id).changes > 0
  }

  // ===== Dashboard Stats =====

  getDashboardStats(): {
    totalApps: number
    activeApps: number
    totalKeys: number
    activeKeys: number
    totalSessions: number
    connectedSessions: number
  } {
    const apps = this.db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active FROM applications').get() as any
    const keys = this.db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active FROM api_keys').get() as any
    const sessions = this.db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END) as connected FROM whatsapp_sessions").get() as any

    return {
      totalApps: apps.total,
      activeApps: apps.active || 0,
      totalKeys: keys.total,
      activeKeys: keys.active || 0,
      totalSessions: sessions.total,
      connectedSessions: sessions.connected || 0,
    }
  }

  close(): void {
    this.db.close()
    AppDatabase.instance = null
  }
}
