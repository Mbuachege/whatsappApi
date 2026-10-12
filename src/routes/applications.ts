import { Router, Request, Response } from 'express'
import { AppDatabase } from '../database/Database'
import { adminAuth } from '../middleware/auth'
import logger from '../utils/logger'

const router = Router()

// All routes require admin auth
router.use(adminAuth)

/**
 * GET /api/v1/applications
 * List all applications
 */
router.get('/', (_req: Request, res: Response): void => {
  try {
    const db = AppDatabase.getInstance()
    const apps = db.listApplications()

    const appsWithKeys = apps.map(app => {
      const keys = db.listApiKeys(app.id)
      const sessions = db.listWhatsAppSessions().filter(s => s.app_id === app.id)
      return {
        ...app,
        keyCount: keys.length,
        activeKeyCount: keys.filter(k => k.is_active).length,
        sessionCount: sessions.length,
      }
    })

    res.status(200).json({
      success: true,
      applications: appsWithKeys,
    })
  } catch (error) {
    logger.error('List apps error:', error)
    res.status(500).json({
      success: false,
      error: { code: 'LIST_ERROR', message: 'Failed to list applications' },
    })
  }
})

/**
 * POST /api/v1/applications
 * Create a new application
 */
router.post('/', (req: Request, res: Response): void => {
  try {
    const { name, description, webhookUrl } = req.body

    if (!name) {
      res.status(400).json({
        success: false,
        error: { code: 'MISSING_NAME', message: 'Application name is required' },
      })
      return
    }

    const db = AppDatabase.getInstance()
    const app = db.createApplication(name, description || '', webhookUrl || null)

    logger.info(`Application created: ${name} (${app.id})`)

    res.status(201).json({
      success: true,
      application: app,
    })
  } catch (error) {
    logger.error('Create app error:', error)
    res.status(500).json({
      success: false,
      error: { code: 'CREATE_ERROR', message: 'Failed to create application' },
    })
  }
})

/**
 * GET /api/v1/applications/:id
 * Get application details
 */
router.get('/:id', (req: Request, res: Response): void => {
  try {
    const db = AppDatabase.getInstance()
    const app = db.getApplication(req.params.id)

    if (!app) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Application not found' },
      })
      return
    }

    const keys = db.listApiKeys(app.id)
    const sessions = db.listWhatsAppSessions().filter(s => s.app_id === app.id)

    res.status(200).json({
      success: true,
      application: app,
      apiKeys: keys.map(k => ({
        ...k,
        key_hash: undefined,
      })),
      sessions,
    })
  } catch (error) {
    logger.error('Get app error:', error)
    res.status(500).json({
      success: false,
      error: { code: 'GET_ERROR', message: 'Failed to get application' },
    })
  }
})

/**
 * PUT /api/v1/applications/:id
 * Update an application
 */
router.put('/:id', (req: Request, res: Response): void => {
  try {
    const db = AppDatabase.getInstance()
    const existing = db.getApplication(req.params.id)

    if (!existing) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Application not found' },
      })
      return
    }

    const { name, description, webhookUrl, isActive } = req.body
    const app = db.updateApplication(req.params.id, {
      name,
      description,
      webhook_url: webhookUrl,
      is_active: isActive,
    })

    logger.info(`Application updated: ${req.params.id}`)

    res.status(200).json({
      success: true,
      application: app,
    })
  } catch (error) {
    logger.error('Update app error:', error)
    res.status(500).json({
      success: false,
      error: { code: 'UPDATE_ERROR', message: 'Failed to update application' },
    })
  }
})

/**
 * DELETE /api/v1/applications/:id
 * Delete an application (cascades to API keys)
 */
router.delete('/:id', (req: Request, res: Response): void => {
  try {
    const db = AppDatabase.getInstance()
    const deleted = db.deleteApplication(req.params.id)

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Application not found' },
      })
      return
    }

    logger.info(`Application deleted: ${req.params.id}`)

    res.status(200).json({
      success: true,
      message: 'Application deleted successfully',
    })
  } catch (error) {
    logger.error('Delete app error:', error)
    res.status(500).json({
      success: false,
      error: { code: 'DELETE_ERROR', message: 'Failed to delete application' },
    })
  }
})

// ===== API Keys =====

/**
 * POST /api/v1/applications/:id/keys
 * Generate a new API key for an application
 */
router.post('/:id/keys', (req: Request, res: Response): void => {
  try {
    const db = AppDatabase.getInstance()
    const app = db.getApplication(req.params.id)

    if (!app) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Application not found' },
      })
      return
    }

    const { name, expiresInDays } = req.body
    const result = db.generateApiKey(req.params.id, name || 'Default', expiresInDays || null)

    logger.info(`API key generated for app ${app.name}: ${result.record.key_prefix}...`)

    res.status(201).json({
      success: true,
      apiKey: result.apiKey,
      message: 'Save this API key now. It will not be shown again.',
      keyInfo: {
        id: result.record.id,
        name: result.record.name,
        prefix: result.record.key_prefix,
        createdAt: result.record.created_at,
        expiresAt: result.record.expires_at,
      },
    })
  } catch (error) {
    logger.error('Generate key error:', error)
    res.status(500).json({
      success: false,
      error: { code: 'KEY_ERROR', message: 'Failed to generate API key' },
    })
  }
})

/**
 * GET /api/v1/applications/:id/keys
 * List all API keys for an application
 */
router.get('/:id/keys', (req: Request, res: Response): void => {
  try {
    const db = AppDatabase.getInstance()
    const keys = db.listApiKeys(req.params.id)

    res.status(200).json({
      success: true,
      apiKeys: keys.map(k => ({
        id: k.id,
        name: k.name,
        prefix: k.key_prefix,
        isActive: k.is_active,
        lastUsedAt: k.last_used_at,
        createdAt: k.created_at,
        expiresAt: k.expires_at,
      })),
    })
  } catch (error) {
    logger.error('List keys error:', error)
    res.status(500).json({
      success: false,
      error: { code: 'LIST_ERROR', message: 'Failed to list API keys' },
    })
  }
})

/**
 * DELETE /api/v1/applications/:appId/keys/:keyId
 * Revoke an API key
 */
router.delete('/:appId/keys/:keyId', (req: Request, res: Response): void => {
  try {
    const db = AppDatabase.getInstance()
    const revoked = db.revokeApiKey(req.params.keyId)

    if (!revoked) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'API key not found' },
      })
      return
    }

    logger.info(`API key revoked: ${req.params.keyId}`)

    res.status(200).json({
      success: true,
      message: 'API key revoked successfully',
    })
  } catch (error) {
    logger.error('Revoke key error:', error)
    res.status(500).json({
      success: false,
      error: { code: 'REVOKE_ERROR', message: 'Failed to revoke API key' },
    })
  }
})

export default router
