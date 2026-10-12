import { Router, Request, Response } from 'express'
import { AppDatabase } from '../database/Database'
import { adminAuth } from '../middleware/auth'
import logger from '../utils/logger'

const router = Router()

/**
 * POST /api/v1/admin/setup
 * Create the initial admin user (only works when no admin exists)
 */
router.post('/setup', (req: Request, res: Response): void => {
  try {
    const db = AppDatabase.getInstance()

    if (db.hasAdminUsers()) {
      res.status(409).json({
        success: false,
        error: { code: 'ALREADY_SETUP', message: 'Admin account already exists. Use /login instead.' },
      })
      return
    }

    const { username, password } = req.body
    if (!username || !password) {
      res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'username and password are required' },
      })
      return
    }

    if (password.length < 8) {
      res.status(400).json({
        success: false,
        error: { code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters' },
      })
      return
    }

    const admin = db.createAdmin(username, password)
    const session = db.createAdminSession(admin.id)

    logger.info(`Admin user created: ${username}`)

    res.status(201).json({
      success: true,
      message: 'Admin account created successfully',
      token: session.token,
      expiresAt: session.expiresAt,
      admin: {
        id: admin.id,
        username: admin.username,
      },
    })
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) {
      res.status(409).json({
        success: false,
        error: { code: 'USERNAME_EXISTS', message: 'Username already taken' },
      })
      return
    }
    logger.error('Setup error:', error)
    res.status(500).json({
      success: false,
      error: { code: 'SETUP_ERROR', message: 'Failed to create admin account' },
    })
  }
})

/**
 * POST /api/v1/admin/login
 * Authenticate admin user
 */
router.post('/login', (req: Request, res: Response): void => {
  try {
    const db = AppDatabase.getInstance()
    const { username, password } = req.body

    if (!username || !password) {
      res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'username and password are required' },
      })
      return
    }

    const admin = db.getAdminByUsername(username)
    if (!admin || !db.verifyPassword(password, admin.password_hash, admin.salt)) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
      })
      return
    }

    db.updateAdminLogin(admin.id)
    const session = db.createAdminSession(admin.id)
    db.cleanExpiredSessions()

    logger.info(`Admin login: ${username}`)

    res.status(200).json({
      success: true,
      token: session.token,
      expiresAt: session.expiresAt,
      admin: {
        id: admin.id,
        username: admin.username,
      },
    })
  } catch (error) {
    logger.error('Login error:', error)
    res.status(500).json({
      success: false,
      error: { code: 'LOGIN_ERROR', message: 'Login failed' },
    })
  }
})

/**
 * POST /api/v1/admin/logout
 * Invalidate admin session
 */
router.post('/logout', adminAuth, (req: Request, res: Response): void => {
  try {
    const token = req.headers.authorization!.substring(7)
    const db = AppDatabase.getInstance()
    db.deleteAdminSession(token)

    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    })
  } catch (error) {
    logger.error('Logout error:', error)
    res.status(500).json({
      success: false,
      error: { code: 'LOGOUT_ERROR', message: 'Logout failed' },
    })
  }
})

/**
 * POST /api/v1/admin/change-password
 */
router.post('/change-password', adminAuth, (req: Request, res: Response): void => {
  try {
    const db = AppDatabase.getInstance()
    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'currentPassword and newPassword are required' },
      })
      return
    }

    if (newPassword.length < 8) {
      res.status(400).json({
        success: false,
        error: { code: 'WEAK_PASSWORD', message: 'New password must be at least 8 characters' },
      })
      return
    }

    const admin = db.getAdminById(req.admin!.id)
    if (!admin || !db.verifyPassword(currentPassword, admin.password_hash, admin.salt)) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect' },
      })
      return
    }

    db.changeAdminPassword(admin.id, newPassword)

    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
    })
  } catch (error) {
    logger.error('Change password error:', error)
    res.status(500).json({
      success: false,
      error: { code: 'PASSWORD_ERROR', message: 'Failed to change password' },
    })
  }
})

/**
 * GET /api/v1/admin/me
 * Get current admin info
 */
router.get('/me', adminAuth, (req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    admin: req.admin,
  })
})

/**
 * GET /api/v1/admin/check
 * Check if setup is needed (no auth required)
 */
router.get('/check', (_req: Request, res: Response): void => {
  try {
    const db = AppDatabase.getInstance()
    res.status(200).json({
      success: true,
      setupRequired: !db.hasAdminUsers(),
    })
  } catch (error) {
    res.status(200).json({
      success: true,
      setupRequired: true,
    })
  }
})

export default router
