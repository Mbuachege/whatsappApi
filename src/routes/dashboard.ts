import { Router, Request, Response } from 'express'
import { AppDatabase } from '../database/Database'
import { adminAuth } from '../middleware/auth'

const router = Router()

/**
 * GET /api/v1/dashboard
 * Get dashboard statistics (admin only)
 */
router.get('/', adminAuth, (_req: Request, res: Response): void => {
  try {
    const db = AppDatabase.getInstance()
    const stats = db.getDashboardStats()

    res.status(200).json({
      success: true,
      stats,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { code: 'STATS_ERROR', message: 'Failed to load dashboard stats' },
    })
  }
})

export default router
