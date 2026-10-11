import express, { Request, Response, NextFunction } from 'express'
import path from 'path'
import { config } from './config/config.js'
import { WhatsAppManager } from './whatsapp/WhatsAppManager.js'
import logger from './utils/logger.js'
import fs from 'fs'

const app = express()
const whatsappManager = new WhatsAppManager(config.whatsapp.dataPath)

// Middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Initialize WhatsApp on startup
whatsappManager.initialize().catch((err) => {
  logger.error('Failed to initialize WhatsApp:', err)
})

// ============================================
// SERVE DASHBOARD AT ROOT
// ============================================
app.get('/', (_req: Request, res: Response): void => {
  try {
    const dashboardPath = path.join(process.cwd(), 'whatsapp-dashboard.html')
    if (fs.existsSync(dashboardPath)) {
      res.sendFile(dashboardPath)
    } else {
      res.status(200).json({
        success: true,
        message: 'WhatsApp API Gateway',
        endpoints: {
          dashboard: 'http://localhost:3000/ (save whatsapp-dashboard.html to project root)',
          health: 'GET http://localhost:3000/api/v1/health',
          status: 'GET http://localhost:3000/api/v1/status',
          qr: 'GET http://localhost:3000/api/v1/qr',
          'pairing-code': 'POST http://localhost:3000/api/v1/pairing-code (body: { phoneNumber })',
          logout: 'POST http://localhost:3000/api/v1/logout',
        },
      })
    }
  } catch (error) {
    logger.error('Dashboard error:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'DASHBOARD_ERROR',
        message: 'Failed to load dashboard',
      },
    })
  }
})

// ============================================
// API ENDPOINTS
// ============================================

app.get('/api/v1/health', (_req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    service: 'whatsapp-api',
    status: 'running',
    timestamp: new Date().toISOString(),
  })
})

app.get('/api/v1/status', (_req: Request, res: Response): void => {
  const state = whatsappManager.getState()
  res.status(200).json({
    success: true,
    whatsapp: {
      status: state.status,
      phone: state.phoneNumber || null,
      error: state.connectionError || null,
    },
    timestamp: new Date().toISOString(),
  })
})

app.get('/api/v1/qr', (_req: Request, res: Response): void => {
  try {
    const qrCode = whatsappManager.getQRCode()
    const state = whatsappManager.getState()

    if (state.status === 'CONNECTED') {
      res.status(200).json({
        success: true,
        connected: true,
        qr: null,
        phone: state.phoneNumber,
      })
    } else if (qrCode) {
      res.status(200).json({
        success: true,
        qr: qrCode,
        status: state.status,
      })
    } else {
      res.status(202).json({
        success: false,
        error: {
          code: 'QR_NOT_AVAILABLE',
          message: 'QR code is not available yet. Please wait...',
        },
      })
    }
  } catch (error) {
    logger.error('QR error:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'QR_ERROR',
        message: 'Failed to generate QR code',
      },
    })
  }
})

/**
 * Request pairing code (8-digit code alternative to QR)
 * POST /api/v1/pairing-code
 * Body: { phoneNumber: "254712345678" }
 */
app.post('/api/v1/pairing-code', async (req: Request, res: Response): Promise<void> => {
  try {
    const { phoneNumber } = req.body

    if (!phoneNumber) {
      res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PHONE_NUMBER',
          message: 'phoneNumber is required in request body',
        },
      })
      return
    }

    const pairingCode = await whatsappManager.requestPairingCode(phoneNumber)

    res.status(200).json({
      success: true,
      pairingCode,
      message: `Enter this 8-digit code on your phone: Settings → Linked Devices → Link with phone number`,
      phoneNumber,
    })
  } catch (error) {
    logger.error('Pairing code error:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'PAIRING_CODE_ERROR',
        message: (error as Error).message || 'Failed to generate pairing code',
      },
    })
  }
})

/**
 * Get pairing code (if already requested)
 * GET /api/v1/pairing-code
 */
app.get('/api/v1/pairing-code', (_req: Request, res: Response): void => {
  try {
    const pairingCode = whatsappManager.getPairingCode()
    const state = whatsappManager.getState()

    if (pairingCode) {
      res.status(200).json({
        success: true,
        pairingCode,
        status: state.status,
      })
    } else {
      res.status(202).json({
        success: false,
        error: {
          code: 'PAIRING_CODE_NOT_AVAILABLE',
          message: 'No pairing code currently available. Request one with POST /api/v1/pairing-code',
        },
      })
    }
  } catch (error) {
    logger.error('Get pairing code error:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'ERROR',
        message: 'Failed to retrieve pairing code',
      },
    })
  }
})

/**
 * Logout from WhatsApp
 * POST /api/v1/logout
 */
app.post('/api/v1/logout', async (_req: Request, res: Response): Promise<void> => {
  try {
    await whatsappManager.logout()

    res.status(200).json({
      success: true,
      message: 'Logged out successfully. Session cleared.',
    })
  } catch (error) {
    logger.error('Logout error:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'LOGOUT_ERROR',
        message: 'Failed to logout',
      },
    })
  }
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
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  })
})

// ============================================
// START SERVER
// ============================================

const PORT = config.server.port

const server = app.listen(PORT, () => {
  logger.info(`🚀 Server running on http://localhost:${PORT}`)
  logger.info(`📊 Dashboard: http://localhost:${PORT}`)
  logger.info(`🔌 Health: http://localhost:${PORT}/api/v1/health`)
  logger.info(`📱 Status: http://localhost:${PORT}/api/v1/status`)
  logger.info(`📲 QR: http://localhost:${PORT}/api/v1/qr`)
  logger.info(`🔐 Pairing Code: POST http://localhost:${PORT}/api/v1/pairing-code`)
  logger.info(`🚪 Logout: POST http://localhost:${PORT}/api/v1/logout`)
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...')
  server.close(async () => {
    await whatsappManager.close()
    process.exit(0)
  })
})

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...')
  server.close(async () => {
    await whatsappManager.close()
    process.exit(0)
  })
})

export default app
