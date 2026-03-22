import express from 'express'
import { getDatabase } from '../database/init.js'
import { upstreamApiAuth } from '../middleware/upstream-api-auth.js'
import { withLocks } from '../utils/locks.js'
import { getUpstreamSettings } from '../utils/upstream-settings.js'
import { getChannels, normalizeChannelKey } from '../utils/channels.js'
import { redeemCodeInternal, RedemptionError } from './redemption-codes.js'
import { normalizeProviderType } from '../services/upstream-provider.js'

const router = express.Router()

const normalizeChannel = (value, fallback = 'common') => normalizeChannelKey(value, fallback)

const isInvalidBusinessError = (error) => {
  const statusCode = Number(error?.statusCode || 0)
  if (statusCode > 0 && statusCode < 500) return true
  const message = String(error?.message || '').trim()
  return (
    message.includes('不存在') ||
    message.includes('已使用') ||
    message.includes('已失效') ||
    message.includes('不可用') ||
    message.includes('渠道') ||
    message.includes('绑定')
  )
}

router.use(upstreamApiAuth)

router.get('/health', async (req, res) => {
  try {
    const settings = await getUpstreamSettings()
    return res.json({
      ok: true,
      status: 'ok',
      message: 'upstream api available',
      data: {
        providerEnabled: Boolean(settings.providerEnabled),
        providerType: String(settings.providerType || 'custom-http'),
        supplierName: String(settings.supplierName || '')
      }
    })
  } catch (error) {
    console.error('[Upstream API] health error:', error)
    return res.status(500).json({ ok: false, status: 'failed', message: 'upstream api unavailable' })
  }
})

router.post('/cards/check', async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim()
    const requestedChannel = normalizeChannel(req.body?.channel, '')
    if (!code) {
      return res.status(400).json({ ok: false, status: 'invalid', message: '缺少卡密' })
    }

    const db = await getDatabase()
    const { byKey: channelsByKey } = await getChannels(db)
    const result = db.exec(
      `
        SELECT code, is_redeemed, channel, redeemed_at, fulfillment_mode, supplier_status
        FROM redemption_codes
        WHERE code = ?
        LIMIT 1
      `,
      [code]
    )

    const row = result[0]?.values?.[0]
    if (!row) {
      return res.json({ ok: false, status: 'invalid', message: '卡密不存在', data: { available: false } })
    }

    const actualChannel = normalizeChannel(row[2], 'common')
    if (requestedChannel && actualChannel !== requestedChannel) {
      return res.json({ ok: false, status: 'invalid', message: '卡密渠道不匹配', data: { available: false, channel: actualChannel } })
    }

    const supplierStatus = String(row[5] || '').trim().toLowerCase() || 'pending'
    if (supplierStatus === 'invalid') {
      return res.json({ ok: false, status: 'invalid', message: '卡密已失效', data: { available: false, channel: actualChannel } })
    }

    if (Number(row[1] || 0) === 1) {
      return res.json({
        ok: false,
        status: 'used',
        message: '卡密已使用',
        data: {
          available: false,
          channel: actualChannel,
          redeemedAt: row[3] || null
        }
      })
    }

    if (supplierStatus === 'processing') {
      return res.json({
        ok: false,
        status: 'failed',
        message: '卡密正在处理中',
        data: {
          available: false,
          channel: actualChannel,
          retryable: true
        }
      })
    }

    const channelConfig = channelsByKey.get(actualChannel)
    return res.json({
      ok: true,
      status: 'available',
      message: '卡密可用',
      data: {
        available: true,
        channel: actualChannel,
        redeemMode: channelConfig?.redeemMode || 'code',
        providerType: normalizeProviderType(channelConfig?.providerType, 'local'),
        fulfillmentMode: String(row[4] || '').trim() || 'internal_invite'
      }
    })
  } catch (error) {
    console.error('[Upstream API] check error:', error)
    return res.status(500).json({ ok: false, status: 'failed', message: '查询卡密失败' })
  }
})

router.post('/cards/redeem', async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim()
    const email = String(req.body?.email || '').trim()
    const channel = normalizeChannel(req.body?.channel, 'common')
    if (!code || !email) {
      return res.status(400).json({ ok: false, status: 'invalid', message: '缺少邮箱或卡密' })
    }

    const result = await withLocks(
      [`upstream-redeem:${code}`],
      () => redeemCodeInternal({
        code,
        email,
        channel,
        skipCodeFormatValidation: true,
        allowCommonChannelFallback: true
      })
    )

    return res.json({
      ok: true,
      status: 'success',
      message: result.data?.message || '兑换成功',
      data: result.data
    })
  } catch (error) {
    if (error instanceof RedemptionError) {
      return res.json({
        ok: false,
        status: isInvalidBusinessError(error) ? 'invalid' : 'failed',
        message: error.message,
        retryable: !isInvalidBusinessError(error),
        data: error.payload || null
      })
    }

    console.error('[Upstream API] redeem error:', error)
    return res.status(500).json({
      ok: false,
      status: 'failed',
      message: '上游兑换失败',
      retryable: true
    })
  }
})

export default router
