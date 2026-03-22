import crypto from 'crypto'
import { getUpstreamSettings } from '../utils/upstream-settings.js'

const normalizeKey = (value) => (typeof value === 'string' ? value.trim() : '')

const timingSafeEqual = (a, b) => {
  const left = normalizeKey(a)
  const right = normalizeKey(b)
  if (!left || !right) return false
  const leftBuf = Buffer.from(left)
  const rightBuf = Buffer.from(right)
  if (leftBuf.length !== rightBuf.length) return false
  return crypto.timingSafeEqual(leftBuf, rightBuf)
}

export async function upstreamApiAuth(req, res, next) {
  try {
    const providedKey = normalizeKey(req.headers['x-upstream-key'])
    const settings = await getUpstreamSettings()

    if (!settings.apiEnabled) {
      return res.status(503).json({ ok: false, status: 'disabled', message: '上游接口未启用' })
    }

    if (!settings.apiKey) {
      return res.status(503).json({ ok: false, status: 'disabled', message: '上游接口密钥未配置' })
    }

    if (!timingSafeEqual(providedKey, settings.apiKey)) {
      return res.status(401).json({ ok: false, status: 'unauthorized', message: 'Unauthorized: Invalid upstream API key' })
    }

    next()
  } catch (error) {
    console.error('[Upstream API] auth failed:', error)
    res.status(500).json({ ok: false, status: 'failed', message: 'Failed to validate upstream API key' })
  }
}
