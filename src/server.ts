import express, { Request, Response, NextFunction } from 'express'
import path from 'path'
import { config } from './config/config'
import { AppDatabase } from './database/Database'
import { SessionManager } from './whatsapp/SessionManager'
import { apiKeyAuth } from './middleware/auth'
import authRoutes from './routes/auth'
import applicationRoutes from './routes/applications'
import dashboardRoutes from './routes/dashboard'
import { createSessionRouter } from './routes/sessions'
import logger from './utils/logger'
import fs from 'fs'

const app = express()

// Initialize database
const db = AppDatabase.getInstance(config.whatsapp.dataPath)

// Initialize multi-session WhatsApp manager
const sessionManager = new SessionManager(config.whatsapp.dataPath)

// Middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// CORS for dashboard
app.use((_req: Request, res: Response, next: NextFunction): void => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key')
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})

// Initialize WhatsApp sessions on startup
sessionManager.initializeAll().catch((err) => {
  logger.error('Failed to initialize WhatsApp sessions:', err)
})

// ============================================
// SERVE ADMIN DASHBOARD AT ROOT
// ============================================
app.get('/', (_req: Request, res: Response): void => {
  try {
    const dashboardPath = path.join(process.cwd(), 'admin-dashboard.html')
    if (fs.existsSync(dashboardPath)) {
      res.sendFile(dashboardPath)
    } else {
      res.status(200).json({
        success: true,
        message: 'WhatsApp API Gateway v2.0',
        dashboard: 'Admin dashboard not found. Ensure admin-dashboard.html is in the project root.',
      })
    }
  } catch (error) {
    logger.error('Dashboard error:', error)
    res.status(500).json({
      success: false,
      error: { code: 'DASHBOARD_ERROR', message: 'Failed to load dashboard' },
    })
  }
})

// ============================================
// HEALTH & STATUS (no auth required)
// ============================================
app.get('/api/v1/health', (_req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    service: 'whatsapp-api-gateway',
    version: '2.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
  })
})

// ============================================
// ADMIN ROUTES (Bearer token auth)
// ============================================
app.use('/api/v1/admin', authRoutes)
app.use('/api/v1/dashboard', dashboardRoutes)
app.use('/api/v1/applications', applicationRoutes)
app.use('/api/v1/sessions', createSessionRouter(sessionManager))

// ============================================
// PUBLIC API ROUTES (API Key auth)
// These are the endpoints external applications use
// ============================================

/**
 * GET /api/v1/status
 * Check WhatsApp connection status (requires API key)
 */
app.get('/api/v1/status', apiKeyAuth, (req: Request, res: Response): void => {
  const sessions = db.listWhatsAppSessions().filter(
    s => s.app_id === req.apiApp!.id || s.app_id === null
  )

  const sessionStatuses = sessions.map(s => {
    const live = sessionManager.getSessionStatus(s.id)
    return {
      id: s.id,
      label: s.label,
      phone: s.phone_number,
      status: live.running ? live.status : s.status,
      connected: live.status === 'CONNECTED',
    }
  })

  res.status(200).json({
    success: true,
    app: req.apiApp!.name,
    sessions: sessionStatuses,
    timestamp: new Date().toISOString(),
  })
})

/**
 * POST /api/v1/send
 * Send a WhatsApp message (requires API key)
 */
app.post('/api/v1/send', apiKeyAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId, to, message } = req.body

    if (!to || !message) {
      res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'to and message are required' },
      })
      return
    }

    // Find the session to use
    let targetSessionId = sessionId
    if (!targetSessionId) {
      const sessions = db.listWhatsAppSessions().filter(
        s => (s.app_id === req.apiApp!.id || s.app_id === null) && s.is_active
      )
      for (const s of sessions) {
        const live = sessionManager.getSessionStatus(s.id)
        if (live.status === 'CONNECTED') {
          targetSessionId = s.id
          break
        }
      }
    }

    if (!targetSessionId) {
      res.status(503).json({
        success: false,
        error: { code: 'NO_SESSION', message: 'No connected WhatsApp session available' },
      })
      return
    }

    const manager = sessionManager.getSession(targetSessionId)
    if (!manager || !manager.isConnected()) {
      res.status(503).json({
        success: false,
        error: { code: 'SESSION_DISCONNECTED', message: 'WhatsApp session is not connected' },
      })
      return
    }

    const sock = manager.getSocket()
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`

    await sock.sendMessage(jid, { text: message })

    res.status(200).json({
      success: true,
      message: 'Message sent',
      to: jid,
      sessionId: targetSessionId,
    })
  } catch (error) {
    logger.error('Send message error:', error)
    res.status(500).json({
      success: false,
      error: { code: 'SEND_ERROR', message: (error as Error).message },
    })
  }
})

// ============================================
// LEGACY ENDPOINTS (backward compatibility)
// ============================================
app.get('/api/v1/qr', (_req: Request, res: Response): void => {
  res.status(200).json({
    success: false,
    error: {
      code: 'DEPRECATED',
      message: 'This endpoint is deprecated. Use /api/v1/sessions/:id/qr instead. Visit the admin dashboard to manage sessions.',
    },
  })
})

app.post('/api/v1/pairing-code', (_req: Request, res: Response): void => {
  res.status(200).json({
    success: false,
    error: {
      code: 'DEPRECATED',
      message: 'This endpoint is deprecated. Use /api/v1/sessions/:id/pairing-code instead. Visit the admin dashboard to manage sessions.',
    },
  })
})

// ============================================
// ERROR HANDLING
// ============================================
app.use((_req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Endpoint not found: ${_req.method} ${_req.path}`,
    },
  })
})

app.use((err: any, _req: Request, res: Response, _next: NextFunction): void => {
  logger.error('Server error:', err)
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  })
})

// ============================================
// START SERVER
// ============================================
const PORT = config.server.port

const server = app.listen(PORT, () => {
  logger.info(`WhatsApp API Gateway v2.0`)
  logger.info(`Server running on http://localhost:${PORT}`)
  logger.info(`Admin Dashboard: http://localhost:${PORT}`)
  logger.info(`Health: http://localhost:${PORT}/api/v1/health`)
})

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully...`)
  server.close(async () => {
    await sessionManager.closeAll()
    db.close()
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export default app
