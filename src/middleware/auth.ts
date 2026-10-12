import { Request, Response, NextFunction } from 'express'
import { AppDatabase } from '../database/Database'
import logger from '../utils/logger'

// Extend Express Request to include auth context
declare global {
  namespace Express {
    interface Request {
      admin?: {
        id: number
        username: string
      }
      apiApp?: {
        id: string
        name: string
      }
      apiKeyId?: string
    }
  }
}

/**
 * Admin authentication middleware
 * Validates Bearer token from admin session
 */
export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Admin authentication required' },
      })
      return
    }

    const token = authHeader.substring(7)
    const db = AppDatabase.getInstance()
    const admin = db.validateAdminSession(token)

    if (!admin) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired session token' },
      })
      return
    }

    req.admin = { id: admin.id, username: admin.username }
    next()
  } catch (error) {
    logger.error('Admin auth error:', error)
    res.status(500).json({
      success: false,
      error: { code: 'AUTH_ERROR', message: 'Authentication failed' },
    })
  }
}

/**
 * API Key authentication middleware
 * Validates X-API-Key header for application requests
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    const apiKey = req.headers['x-api-key'] as string
    if (!apiKey) {
      res.status(401).json({
        success: false,
        error: { code: 'API_KEY_REQUIRED', message: 'X-API-Key header is required' },
      })
      return
    }

    const db = AppDatabase.getInstance()
    const result = db.validateApiKey(apiKey)

    if (!result) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_API_KEY', message: 'Invalid, expired, or deactivated API key' },
      })
      return
    }

    req.apiApp = { id: result.app.id, name: result.app.name }
    req.apiKeyId = result.key.id
    next()
  } catch (error) {
    logger.error('API key auth error:', error)
    res.status(500).json({
      success: false,
      error: { code: 'AUTH_ERROR', message: 'Authentication failed' },
    })
  }
}

/**
 * Setup check middleware
 * Returns 503 if no admin user has been created yet (initial setup required)
 */
export function requireSetup(_req: Request, res: Response, next: NextFunction): void {
  try {
    const db = AppDatabase.getInstance()
    if (!db.hasAdminUsers()) {
      res.status(503).json({
        success: false,
        error: {
          code: 'SETUP_REQUIRED',
          message: 'Initial admin setup required. POST /api/v1/admin/setup',
        },
      })
      return
    }
    next()
  } catch (error) {
    next()
  }
}
