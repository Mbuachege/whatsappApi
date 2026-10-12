import { WhatsAppManager } from './WhatsAppManager'
import { AppDatabase } from '../database/Database'
import logger from '../utils/logger'
import path from 'path'

/**
 * Multi-session WhatsApp manager
 * Manages multiple WhatsApp connections, each identified by a session ID
 */
export class SessionManager {
  private sessions: Map<string, WhatsAppManager> = new Map()
  private basePath: string

  constructor(basePath: string) {
    this.basePath = basePath
  }

  /**
   * Initialize all active sessions from the database
   */
  async initializeAll(): Promise<void> {
    try {
      const db = AppDatabase.getInstance()
      const dbSessions = db.listWhatsAppSessions()
      const activeSessions = dbSessions.filter(s => s.is_active)

      logger.info(`Found ${activeSessions.length} active WhatsApp session(s) to initialize`)

      for (const session of activeSessions) {
        try {
          await this.startSession(session.id)
        } catch (error) {
          logger.error(`Failed to initialize session ${session.id} (${session.label}):`, error)
          db.updateWhatsAppSession(session.id, { status: 'error' })
        }
      }
    } catch (error) {
      logger.error('Failed to initialize sessions:', error)
    }
  }

  /**
   * Start a WhatsApp session
   */
  async startSession(sessionId: string): Promise<WhatsAppManager> {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!
    }

    const sessionPath = path.join(this.basePath, 'sessions', sessionId)
    const manager = new WhatsAppManager(sessionPath)

    const db = AppDatabase.getInstance()
    db.updateWhatsAppSession(sessionId, { status: 'connecting' })

    // Hook into connection events to update DB
    const originalInit = manager.initialize.bind(manager)
    manager.initialize = async () => {
      await originalInit()

      // Poll for connection status changes
      const statusInterval = setInterval(() => {
        const state = manager.getState()
        const dbSession = db.getWhatsAppSession(sessionId)
        if (!dbSession) {
          clearInterval(statusInterval)
          return
        }

        let newStatus = state.status.toLowerCase()
        if (newStatus === 'qr' || newStatus === 'pairing_code') {
          newStatus = 'awaiting_auth'
        }

        if (dbSession.status !== newStatus) {
          db.updateWhatsAppSession(sessionId, {
            status: newStatus,
            phone_number: state.phoneNumber || dbSession.phone_number,
          })
        }

        if (newStatus === 'logged_out' || !dbSession.is_active) {
          clearInterval(statusInterval)
        }
      }, 3000)
    }

    await manager.initialize()
    this.sessions.set(sessionId, manager)

    logger.info(`WhatsApp session started: ${sessionId}`)
    return manager
  }

  /**
   * Stop a WhatsApp session
   */
  async stopSession(sessionId: string): Promise<void> {
    const manager = this.sessions.get(sessionId)
    if (manager) {
      await manager.close()
      this.sessions.delete(sessionId)

      const db = AppDatabase.getInstance()
      db.updateWhatsAppSession(sessionId, { status: 'disconnected' })

      logger.info(`WhatsApp session stopped: ${sessionId}`)
    }
  }

  /**
   * Get a running session's manager
   */
  getSession(sessionId: string): WhatsAppManager | null {
    return this.sessions.get(sessionId) || null
  }

  /**
   * Get all running session IDs
   */
  getRunningSessions(): string[] {
    return Array.from(this.sessions.keys())
  }

  /**
   * Get status of a session
   */
  getSessionStatus(sessionId: string): {
    running: boolean
    status: string
    phoneNumber: string | null
    qrAvailable: boolean
  } {
    const manager = this.sessions.get(sessionId)
    if (!manager) {
      return {
        running: false,
        status: 'stopped',
        phoneNumber: null,
        qrAvailable: false,
      }
    }

    const state = manager.getState()
    return {
      running: true,
      status: state.status,
      phoneNumber: state.phoneNumber,
      qrAvailable: !!manager.getQRCode(),
    }
  }

  /**
   * Close all sessions gracefully
   */
  async closeAll(): Promise<void> {
    logger.info('Closing all WhatsApp sessions...')
    const promises = Array.from(this.sessions.entries()).map(async ([id, manager]) => {
      try {
        await manager.close()
        logger.info(`Session ${id} closed`)
      } catch (error) {
        logger.error(`Error closing session ${id}:`, error)
      }
    })
    await Promise.all(promises)
    this.sessions.clear()
  }
}
