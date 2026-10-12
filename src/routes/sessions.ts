import { Router, Request, Response } from 'express'
import { AppDatabase } from '../database/Database'
import { SessionManager } from '../whatsapp/SessionManager'
import { adminAuth } from '../middleware/auth'
import logger from '../utils/logger'

export function createSessionRouter(sessionManager: SessionManager): Router {
  const router = Router()
  router.use(adminAuth)

  /**
   * GET /api/v1/sessions
   * List all WhatsApp sessions
   */
  router.get('/', (_req: Request, res: Response): void => {
    try {
      const db = AppDatabase.getInstance()
      const dbSessions = db.listWhatsAppSessions()

      const sessions = dbSessions.map(s => {
        const liveStatus = sessionManager.getSessionStatus(s.id)
        return {
          ...s,
          liveStatus: liveStatus.running ? liveStatus.status : s.status,
          running: liveStatus.running,
          qrAvailable: liveStatus.qrAvailable,
        }
      })

      res.status(200).json({ success: true, sessions })
    } catch (error) {
      logger.error('List sessions error:', error)
      res.status(500).json({
        success: false,
        error: { code: 'LIST_ERROR', message: 'Failed to list sessions' },
      })
    }
  })

  /**
   * POST /api/v1/sessions
   * Create a new WhatsApp session
   */
  router.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const { label, appId } = req.body

      if (!label) {
        res.status(400).json({
          success: false,
          error: { code: 'MISSING_LABEL', message: 'Session label is required' },
        })
        return
      }

      const db = AppDatabase.getInstance()
      const session = db.createWhatsAppSession(label, appId || null)

      logger.info(`WhatsApp session created: ${session.label} (${session.id})`)

      res.status(201).json({
        success: true,
        session,
        message: 'Session created. Use /connect to start it.',
      })
    } catch (error) {
      logger.error('Create session error:', error)
      res.status(500).json({
        success: false,
        error: { code: 'CREATE_ERROR', message: 'Failed to create session' },
      })
    }
  })

  /**
   * GET /api/v1/sessions/:id
   * Get session details
   */
  router.get('/:id', (req: Request, res: Response): void => {
    try {
      const db = AppDatabase.getInstance()
      const session = db.getWhatsAppSession(req.params.id)

      if (!session) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' },
        })
        return
      }

      const liveStatus = sessionManager.getSessionStatus(session.id)

      res.status(200).json({
        success: true,
        session: {
          ...session,
          liveStatus: liveStatus.running ? liveStatus.status : session.status,
          running: liveStatus.running,
          qrAvailable: liveStatus.qrAvailable,
        },
      })
    } catch (error) {
      logger.error('Get session error:', error)
      res.status(500).json({
        success: false,
        error: { code: 'GET_ERROR', message: 'Failed to get session' },
      })
    }
  })

  /**
   * POST /api/v1/sessions/:id/connect
   * Start/connect a WhatsApp session
   */
  router.post('/:id/connect', async (req: Request, res: Response): Promise<void> => {
    try {
      const db = AppDatabase.getInstance()
      const session = db.getWhatsAppSession(req.params.id)

      if (!session) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' },
        })
        return
      }

      await sessionManager.startSession(session.id)

      res.status(200).json({
        success: true,
        message: 'Session connecting. Use /qr or /pairing-code to authenticate.',
        session: {
          id: session.id,
          label: session.label,
          status: 'connecting',
        },
      })
    } catch (error) {
      logger.error('Connect session error:', error)
      res.status(500).json({
        success: false,
        error: { code: 'CONNECT_ERROR', message: 'Failed to connect session' },
      })
    }
  })

  /**
   * POST /api/v1/sessions/:id/disconnect
   * Disconnect a WhatsApp session
   */
  router.post('/:id/disconnect', async (req: Request, res: Response): Promise<void> => {
    try {
      await sessionManager.stopSession(req.params.id)

      res.status(200).json({
        success: true,
        message: 'Session disconnected',
      })
    } catch (error) {
      logger.error('Disconnect session error:', error)
      res.status(500).json({
        success: false,
        error: { code: 'DISCONNECT_ERROR', message: 'Failed to disconnect session' },
      })
    }
  })

  /**
   * GET /api/v1/sessions/:id/qr
   * Get QR code for a session
   */
  router.get('/:id/qr', (req: Request, res: Response): void => {
    try {
      const manager = sessionManager.getSession(req.params.id)

      if (!manager) {
        res.status(400).json({
          success: false,
          error: { code: 'NOT_RUNNING', message: 'Session is not running. Connect it first.' },
        })
        return
      }

      const state = manager.getState()

      if (state.status === 'CONNECTED') {
        res.status(200).json({
          success: true,
          connected: true,
          phone: state.phoneNumber,
        })
        return
      }

      const qr = manager.getQRCode()
      if (qr) {
        res.status(200).json({
          success: true,
          qr,
          status: state.status,
        })
      } else {
        res.status(202).json({
          success: false,
          error: { code: 'QR_NOT_READY', message: 'QR code not yet available. Please wait...' },
        })
      }
    } catch (error) {
      logger.error('QR error:', error)
      res.status(500).json({
        success: false,
        error: { code: 'QR_ERROR', message: 'Failed to get QR code' },
      })
    }
  })

  /**
   * POST /api/v1/sessions/:id/pairing-code
   * Request pairing code for a session
   */
  router.post('/:id/pairing-code', async (req: Request, res: Response): Promise<void> => {
    try {
      const { phoneNumber } = req.body
      if (!phoneNumber) {
        res.status(400).json({
          success: false,
          error: { code: 'MISSING_PHONE', message: 'phoneNumber is required' },
        })
        return
      }

      const manager = sessionManager.getSession(req.params.id)
      if (!manager) {
        res.status(400).json({
          success: false,
          error: { code: 'NOT_RUNNING', message: 'Session is not running. Connect it first.' },
        })
        return
      }

      const code = await manager.requestPairingCode(phoneNumber)

      const db = AppDatabase.getInstance()
      db.updateWhatsAppSession(req.params.id, { phone_number: phoneNumber })

      res.status(200).json({
        success: true,
        pairingCode: code,
        message: 'Enter this code on your phone: Settings > Linked Devices > Link with phone number',
        phoneNumber,
      })
    } catch (error) {
      logger.error('Pairing code error:', error)
      res.status(500).json({
        success: false,
        error: { code: 'PAIRING_ERROR', message: (error as Error).message },
      })
    }
  })

  /**
   * POST /api/v1/sessions/:id/logout
   * Logout from WhatsApp (clears session auth)
   */
  router.post('/:id/logout', async (req: Request, res: Response): Promise<void> => {
    try {
      const manager = sessionManager.getSession(req.params.id)
      if (manager) {
        await manager.logout()
        sessionManager.getSession(req.params.id) // clear reference
      }

      const db = AppDatabase.getInstance()
      db.updateWhatsAppSession(req.params.id, {
        status: 'logged_out',
        phone_number: null,
      })

      await sessionManager.stopSession(req.params.id)

      res.status(200).json({
        success: true,
        message: 'Logged out and session cleared',
      })
    } catch (error) {
      logger.error('Logout error:', error)
      res.status(500).json({
        success: false,
        error: { code: 'LOGOUT_ERROR', message: 'Failed to logout' },
      })
    }
  })

  /**
   * PUT /api/v1/sessions/:id
   * Update session (label, app assignment, active status)
   */
  router.put('/:id', (req: Request, res: Response): void => {
    try {
      const db = AppDatabase.getInstance()
      const existing = db.getWhatsAppSession(req.params.id)

      if (!existing) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' },
        })
        return
      }

      const { label, appId, isActive } = req.body
      const session = db.updateWhatsAppSession(req.params.id, {
        label,
        app_id: appId,
        is_active: isActive,
      })

      res.status(200).json({ success: true, session })
    } catch (error) {
      logger.error('Update session error:', error)
      res.status(500).json({
        success: false,
        error: { code: 'UPDATE_ERROR', message: 'Failed to update session' },
      })
    }
  })

  /**
   * DELETE /api/v1/sessions/:id
   * Delete a WhatsApp session
   */
  router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      await sessionManager.stopSession(req.params.id)

      const db = AppDatabase.getInstance()
      const deleted = db.deleteWhatsAppSession(req.params.id)

      if (!deleted) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' },
        })
        return
      }

      res.status(200).json({
        success: true,
        message: 'Session deleted',
      })
    } catch (error) {
      logger.error('Delete session error:', error)
      res.status(500).json({
        success: false,
        error: { code: 'DELETE_ERROR', message: 'Failed to delete session' },
      })
    }
  })

  return router
}
