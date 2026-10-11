import Database from 'better-sqlite3'
import path from 'path'
import {
  AuthenticationCreds,
  SignalDataSet,
} from '@whiskeysockets/baileys'
import { BufferJSON } from '@whiskeysockets/baileys'
import logger from './logger'

/**
 * SQLite-based authentication state store for production use
 * Replaces file-based storage with reliable database persistence
 */
export class SQLiteAuthStore {
  private db: Database.Database
  private credsPath: string

  constructor(dataPath: string = './.waweb') {
    this.credsPath = path.join(dataPath, 'auth.db')

    // Create database connection with write-ahead logging for better concurrency
    this.db = new Database(this.credsPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL') // Balance between safety and speed

    // Initialize tables
    this.initializeTables()
    logger.info(`SQLite auth store initialized at ${this.credsPath}`)
  }

  private initializeTables() {
    // Store credentials as JSON
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS creds (
        id INTEGER PRIMARY KEY CHECK (id = 0),
        data TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Store Signal protocol keys
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS signal_keys (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Create index for faster lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_signal_keys_type ON signal_keys(type)
    `)
  }

  /**
   * Get authentication credentials
   */
  async getCreds(): Promise<AuthenticationCreds | null> {
    try {
      const stmt = this.db.prepare('SELECT data FROM creds WHERE id = 0')
      const row = stmt.get() as any

      if (!row) return null

      return JSON.parse(row.data, BufferJSON.reviver)
    } catch (error) {
      logger.error('Error getting credentials:', error)
      return null
    }
  }

  /**
   * Save authentication credentials
   */
  async saveCreds(creds: AuthenticationCreds): Promise<void> {
    try {
      const data = JSON.stringify(creds, BufferJSON.replacer)
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO creds (id, data, updated_at)
        VALUES (0, ?, CURRENT_TIMESTAMP)
      `)
      stmt.run(data)
      logger.debug('Credentials saved to database')
    } catch (error) {
      logger.error('Error saving credentials:', error)
      throw error
    }
  }

  /**
   * Get Signal protocol keys
   */
  async getKeys(
    type: string,
    ids: string[]
  ): Promise<Record<string, any>> {
    try {
      const placeholders = ids.map(() => '?').join(',')
      const stmt = this.db.prepare(`
        SELECT id, data FROM signal_keys
        WHERE type = ? AND id IN (${placeholders})
      `)

      const rows = stmt.all(type, ...ids) as any[]
      const result: Record<string, any> = {}

      for (const row of rows) {
        result[row.id] = JSON.parse(row.data, BufferJSON.reviver)
      }

      return result
    } catch (error) {
      logger.error('Error getting keys:', error)
      return {}
    }
  }

  /**
   * Save Signal protocol keys
   */
  async setKeys(data: SignalDataSet): Promise<void> {
    try {
      const insertStmt = this.db.prepare(`
        INSERT OR REPLACE INTO signal_keys (id, type, data, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `)

      // Use transaction for atomic writes
      const transaction = this.db.transaction((records: any[]) => {
        for (const record of records) {
          insertStmt.run(
            record.id,
            record.type,
            JSON.stringify(record.data, BufferJSON.replacer)
          )
        }
      })

      // Flatten the data structure for transaction
      const records: any[] = []
      for (const [type, typeData] of Object.entries(data)) {
        for (const [id, value] of Object.entries(typeData as any)) {
          if (value === null) {
            // Delete if null
            const deleteStmt = this.db.prepare('DELETE FROM signal_keys WHERE id = ? AND type = ?')
            deleteStmt.run(id, type)
          } else {
            records.push({
              id,
              type,
              data: value,
            })
          }
        }
      }

      if (records.length > 0) {
        transaction(records)
      }

      logger.debug(`Saved ${records.length} Signal keys`)
    } catch (error) {
      logger.error('Error saving keys:', error)
      throw error
    }
  }

  /**
   * Clear all authentication data
   */
  async clear(): Promise<void> {
    try {
      this.db.exec('DELETE FROM creds; DELETE FROM signal_keys;')
      logger.info('Auth store cleared')
    } catch (error) {
      logger.error('Error clearing auth store:', error)
      throw error
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    try {
      this.db.close()
      logger.info('Auth store database closed')
    } catch (error) {
      logger.error('Error closing auth store:', error)
    }
  }

  /**
   * Get authentication state compatible with Baileys
   */
  async getAuthState(): Promise<AuthenticationState> {
    const creds = await this.getCreds()

    return {
      creds: creds || {} as AuthenticationCreds,
      keys: {
        get: (type: string, ids: string[]) => this.getKeys(type, ids),
        set: (data: SignalDataSet) => this.setKeys(data),
        clear: () => this.clear(),
      },
    }
  }
}
