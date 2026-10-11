import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import P from 'pino'
import logger from '../utils/logger.js'
import { SQLiteAuthStore } from '../utils/auth-store.js'

interface ManagerState {
  status: 'DISCONNECTED' | 'CONNECTING' | 'QR' | 'PAIRING_CODE' | 'CONNECTED' | 'LOGGED_OUT'
  phoneNumber: string | null
  connectionError: string | null
}

/**
 * Production-ready WhatsApp Manager with:
 * - SQLite auth persistence
 * - Cacheable Signal keys for performance
 * - Proper reconnection handling
 * - Pairing code support
 * - QR code support
 */
export class WhatsAppManager {
  private sock: any = null
  private state: ManagerState = {
    status: 'DISCONNECTED',
    phoneNumber: null,
    connectionError: null,
  }
  private qrCode: string | null = null
  private pairingCode: string | null = null
  private authStore: SQLiteAuthStore
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 5
  private reconnectDelay: number = 3000
  private pinoLogger = P({ level: 'silent' }) // Suppress Baileys internal logs

  constructor(dataPath: string = './.waweb') {
    this.authStore = new SQLiteAuthStore(dataPath)
  }

  /**
   * Initialize WhatsApp connection
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing WhatsApp Manager...')
      this.state.status = 'CONNECTING'

      // Get stored authentication state
      const authState = await this.authStore.getAuthState()

      // Create socket with optimized configuration
      this.sock = makeWASocket({
        auth: {
          creds: authState.creds,
          // Use cacheable Signal keys for better performance
          keys: makeCacheableSignalKeyStore(authState.keys, this.pinoLogger),
        },
        printQRInTerminal: false, // Deprecated - we handle QR ourselves
        browser: ['Ubuntu', 'Chrome', '120.0.0.0'], // Identify as Chrome on Ubuntu
        syncFullHistory: false, // Don't sync full history on first connection
      })

      // Setup event handlers
      this.setupEventHandlers()

      logger.info('WhatsApp Manager initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize WhatsApp Manager:', error)
      this.state.status = 'DISCONNECTED'
      this.state.connectionError = 'Initialization failed'
      throw error
    }
  }

  /**
   * Setup all event handlers
   */
  private setupEventHandlers(): void {
    // Connection update handler
    this.sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update

      // Handle QR code
      if (qr) {
        logger.info('QR code generated, waiting for scan...')
        this.qrCode = qr
        this.state.status = 'QR'
        this.state.connectionError = null
      }

      // Handle connection state changes
      if (connection === 'open') {
        logger.info('✅ Connected to WhatsApp')
        this.state.status = 'CONNECTED'
        this.state.connectionError = null
        this.reconnectAttempts = 0 // Reset reconnect counter on success

        // Get phone number from credentials
        const phoneNumber = this.sock.user?.id?.split(':')[0]
        if (phoneNumber) {
          this.state.phoneNumber = phoneNumber
          logger.info(`Connected phone: ${phoneNumber}`)
        }
      } else if (connection === 'close') {
        // Handle disconnection
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
        const reason = DisconnectReason[statusCode || 500]

        logger.warn(`Disconnected: ${reason}`)

        // Determine if we should reconnect
        const shouldReconnect =
          statusCode !== DisconnectReason.loggedOut &&
          statusCode !== DisconnectReason.forbidden &&
          statusCode !== DisconnectReason.badSession

        if (shouldReconnect) {
          this.state.status = 'DISCONNECTED'
          this.state.connectionError = `Disconnected: ${reason}`

          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++
            const delay = this.reconnectDelay * this.reconnectAttempts
            logger.info(
              `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
            )
            setTimeout(() => this.initialize(), delay)
          } else {
            this.state.connectionError = 'Max reconnection attempts exceeded'
            logger.error('Max reconnection attempts exceeded. Please restart.')
          }
        } else {
          this.state.status = 'LOGGED_OUT'
          this.state.connectionError = 'Logged out or session invalid'
          logger.info('Session logged out. Please re-authenticate.')
        }
      }
    })

    // Handle credential updates
    this.sock.ev.on('creds.update', async (update: any) => {
      logger.debug('Credentials updated, saving to database...')
      try {
        // Extract the updated credentials from the update event
        if (update.creds) {
          await this.authStore.saveCreds(update.creds)
        }
      } catch (error) {
        logger.error('Failed to save credentials:', error)
      }
    })

    // Handle errors
    this.sock.ev.on('error', (error: any) => {
      logger.error('Socket error:', error)
      this.state.connectionError = error.message || 'Socket error'
    })
  }

  /**
   * Request pairing code (alternative to QR)
   * Returns 8-digit code to enter on phone
   */
  async requestPairingCode(phoneNumber: string): Promise<string> {
    try {
      if (!this.sock) {
        throw new Error('Socket not initialized')
      }

      // Validate phone number format
      if (!/^\d{7,15}$/.test(phoneNumber)) {
        throw new Error(
          'Invalid phone number format. Use digits only with country code (e.g., 254712345678)'
        )
      }

      logger.info(`Requesting pairing code for ${phoneNumber}`)
      this.state.status = 'PAIRING_CODE'

      const code = await this.sock.requestPairingCode(phoneNumber)
      this.pairingCode = code

      logger.info(`Pairing code generated: ${code}`)
      return code
    } catch (error) {
      logger.error('Failed to request pairing code:', error)
      this.state.connectionError = (error as Error).message
      throw error
    }
  }

  /**
   * Get current QR code
   */
  getQRCode(): string | null {
    return this.qrCode
  }

  /**
   * Get current pairing code
   */
  getPairingCode(): string | null {
    return this.pairingCode
  }

  /**
   * Get current connection state
   */
  getState(): ManagerState {
    return { ...this.state }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state.status === 'CONNECTED'
  }

  /**
   * Logout and clear session
   */
  async logout(): Promise<void> {
    try {
      logger.info('Logging out...')
      if (this.sock) {
        await this.sock.logout()
      }
      await this.authStore.clear()
      this.state.status = 'LOGGED_OUT'
      this.state.phoneNumber = null
      this.qrCode = null
      this.pairingCode = null
      logger.info('Logged out successfully')
    } catch (error) {
      logger.error('Error during logout:', error)
      throw error
    }
  }

  /**
   * Close connection and cleanup
   */
  async close(): Promise<void> {
    try {
      logger.info('Closing WhatsApp Manager...')
      if (this.sock) {
        await this.sock.ws.close()
      }
      this.authStore.close()
      this.sock = null
      logger.info('WhatsApp Manager closed')
    } catch (error) {
      logger.error('Error closing WhatsApp Manager:', error)
    }
  }

  /**
   * Get socket instance (for advanced usage)
   */
  getSocket(): any {
    return this.sock
  }
}
