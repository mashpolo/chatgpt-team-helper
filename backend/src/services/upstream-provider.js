import axios from 'axios'
import crypto from 'crypto'
import { getUpstreamSettings } from '../utils/upstream-settings.js'

export const UPSTREAM_PROVIDER_TYPES = {
  LOCAL: 'local',
  CUSTOM_HTTP: 'custom-http',
  PLATFORM_UPSTREAM: 'platform-upstream',
}

const UPSTREAM_PROVIDER_TYPE_SET = new Set(Object.values(UPSTREAM_PROVIDER_TYPES))

export const normalizeProviderType = (value, fallback = UPSTREAM_PROVIDER_TYPES.CUSTOM_HTTP) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'legacy-http') return UPSTREAM_PROVIDER_TYPES.CUSTOM_HTTP
  return UPSTREAM_PROVIDER_TYPE_SET.has(normalized) ? normalized : fallback
}

const buildUrl = (baseUrl, path) => {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  const suffix = String(path || '').trim()
  if (!base) return ''
  if (!suffix) return base
  return `${base}${suffix.startsWith('/') ? suffix : `/${suffix}`}`
}

const toRawString = (value) => {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const buildProviderResult = ({
  ok,
  status,
  retryable,
  providerType,
  supplierName,
  requestId,
  responseCode,
  message,
  redeemedAt,
  responseRaw,
  data
}) => ({
  ok: Boolean(ok),
  status: String(status || 'failed'),
  retryable: Boolean(retryable),
  providerType: normalizeProviderType(providerType),
  supplierName: String(supplierName || '').trim(),
  requestId: String(requestId || '').trim(),
  responseCode: responseCode == null ? '' : String(responseCode),
  message: String(message || '').trim() || '兑换失败，请稍后重试',
  redeemedAt: redeemedAt || null,
  responseRaw: String(responseRaw || ''),
  data: data || null
})

const isLegacyInvalidMessage = (message) => {
  const normalized = String(message || '').trim()
  return normalized.includes('卡密不存在') || normalized.includes('已使用')
}

const DEFAULT_CUSTOM_HTTP_BODY_TEMPLATE = JSON.stringify({
  userEmail: '{{email}}',
  cardCode: '{{code}}'
}, null, 2)
const PLATFORM_UPSTREAM_REDEEM_PATH = '/api/upstream/cards/redeem'

const resolveCustomRequestUrl = (settings) => {
  return String(settings?.customUrl || '').trim()
}

const interpolateTemplateString = (template, payload) => (
  String(template || '').replace(/\{\{\s*(email|code|channel)\s*\}\}/gi, (_, rawKey) => {
    const key = String(rawKey || '').trim().toLowerCase()
    if (key === 'email') return String(payload?.email || '')
    if (key === 'code') return String(payload?.code || '')
    if (key === 'channel') return String(payload?.channel || '')
    return ''
  })
)

const applyTemplatePayload = (value, payload) => {
  if (typeof value === 'string') {
    return interpolateTemplateString(value, payload)
  }
  if (Array.isArray(value)) {
    return value.map(item => applyTemplatePayload(item, payload))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, applyTemplatePayload(entry, payload)])
    )
  }
  return value
}

const buildCustomRequestBody = (template, payload) => {
  const rawTemplate = String(template || '').trim() || DEFAULT_CUSTOM_HTTP_BODY_TEMPLATE
  const parsedTemplate = JSON.parse(rawTemplate)
  const parsed = applyTemplatePayload(parsedTemplate, payload)
  return {
    rawTemplate,
    parsed
  }
}

export const getUpstreamProviderReadiness = (settings, providerTypeValue) => {
  const providerType = normalizeProviderType(providerTypeValue || settings?.providerType)

  if (providerType === UPSTREAM_PROVIDER_TYPES.LOCAL) {
    return {
      ready: false,
      providerType,
      responseCode: 'CONFIG',
      message: '服务配置错误，请联系管理员'
    }
  }

  if (!settings?.providerEnabled) {
    return {
      ready: false,
      providerType,
      responseCode: 'DISABLED',
      message: '服务暂不可用，请联系管理员'
    }
  }

  if (providerType === UPSTREAM_PROVIDER_TYPES.PLATFORM_UPSTREAM) {
    const baseUrl = String(settings?.baseUrl || '').trim()
    if (!baseUrl) {
      return {
        ready: false,
        providerType,
        responseCode: 'CONFIG',
        message: '服务暂不可用，请联系管理员'
      }
    }
    try {
      const parsed = new URL(baseUrl)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid_protocol')
    } catch {
      return {
        ready: false,
        providerType,
        responseCode: 'CONFIG',
        message: '服务配置错误，请联系管理员'
      }
    }
    return { ready: true, providerType, responseCode: '', message: '' }
  }

  const requestUrl = resolveCustomRequestUrl(settings)
  if (!requestUrl) {
    return {
      ready: false,
      providerType,
      responseCode: 'CONFIG',
      message: '服务暂不可用，请联系管理员'
    }
  }

  try {
    const parsed = new URL(requestUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid_protocol')
  } catch {
    return {
      ready: false,
      providerType,
      responseCode: 'CONFIG',
      message: '服务配置错误，请联系管理员'
    }
  }

  try {
    buildCustomRequestBody(settings?.customBodyTemplate, {
      email: 'demo@example.com',
      code: 'DEMO-CODE',
      channel: 'common'
    })
  } catch {
    return {
      ready: false,
      providerType,
      responseCode: 'CONFIG',
      message: '服务配置错误，请联系管理员'
    }
  }

  return { ready: true, providerType, responseCode: '', message: '' }
}

async function redeemWithCustomHttp(settings, payload) {
  const requestId = crypto.randomUUID()
  const requestUrl = resolveCustomRequestUrl(settings)
  const url = new URL(requestUrl)
  const requestBody = buildCustomRequestBody(settings.customBodyTemplate, payload)

  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'User-Agent': 'chatgpt-team-helper/upstream-provider',
    Origin: url.origin,
    Referer: `${url.origin}/`
  }

  try {
    const response = await axios.post(
      requestUrl,
      requestBody.parsed,
      {
        timeout: settings.timeoutMs,
        headers
      }
    )

    const responseRaw = toRawString(response.data)
    const explicitCode = response.data?.code
    const explicitMessage = String(response.data?.message || '').trim()
    if (explicitCode === 400 && isLegacyInvalidMessage(explicitMessage)) {
      return buildProviderResult({
        ok: false,
        status: 'invalid',
        retryable: false,
        providerType: UPSTREAM_PROVIDER_TYPES.CUSTOM_HTTP,
        supplierName: settings.supplierName,
        requestId,
        responseCode: explicitCode,
        message: explicitMessage || '卡密不存在或已使用',
        responseRaw,
        data: response.data
      })
    }

    return buildProviderResult({
      ok: true,
      status: 'success',
      retryable: false,
      providerType: UPSTREAM_PROVIDER_TYPES.CUSTOM_HTTP,
      supplierName: settings.supplierName,
      requestId,
      responseCode: response.status,
      message: '兑换成功，权益已开通',
      redeemedAt: new Date().toISOString(),
      responseRaw,
      data: response.data
    })
  } catch (error) {
    const responseStatus = error.response?.status
    const responseData = error.response?.data
    const responseRaw = toRawString(responseData || error.message)
    const explicitCode = responseData?.code ?? responseStatus
    const explicitMessage = String(responseData?.message || responseData?.error || error.message || '').trim()

    if (Number(explicitCode) === 400 && isLegacyInvalidMessage(explicitMessage)) {
      return buildProviderResult({
        ok: false,
        status: 'invalid',
        retryable: false,
        providerType: UPSTREAM_PROVIDER_TYPES.CUSTOM_HTTP,
        supplierName: settings.supplierName,
        requestId,
        responseCode: explicitCode,
        message: explicitMessage || '卡密不存在或已使用',
        responseRaw,
        data: responseData
      })
    }

    return buildProviderResult({
      ok: false,
      status: 'failed',
      retryable: true,
      providerType: UPSTREAM_PROVIDER_TYPES.CUSTOM_HTTP,
      supplierName: settings.supplierName,
      requestId,
      responseCode: explicitCode || 'NETWORK',
      message: explicitMessage || '兑换失败，请稍后重试',
      responseRaw,
      data: responseData
    })
  }
}

async function redeemWithPlatformUpstream(settings, payload) {
  const requestId = crypto.randomUUID()
  const requestUrl = buildUrl(settings.baseUrl, PLATFORM_UPSTREAM_REDEEM_PATH)
  if (!requestUrl) {
    return buildProviderResult({
      ok: false,
      status: 'failed',
      retryable: false,
      providerType: UPSTREAM_PROVIDER_TYPES.PLATFORM_UPSTREAM,
      supplierName: settings.supplierName,
      requestId,
      responseCode: 'CONFIG',
      message: '服务暂不可用，请联系管理员'
    })
  }

  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'User-Agent': 'chatgpt-team-helper/upstream-provider',
    ...(settings.outboundApiKey ? { 'X-Upstream-Key': settings.outboundApiKey } : {})
  }

  try {
    const response = await axios.post(
      requestUrl,
      {
        email: payload.email,
        code: payload.code,
        channel: payload.channel || 'common'
      },
      {
        timeout: settings.timeoutMs,
        headers
      }
    )

    const body = response.data || {}
    const responseRaw = toRawString(body)
    const status = String(body.status || '').trim().toLowerCase()
    const message = String(body.message || '').trim()

    if (body.ok === true && status === 'success') {
      return buildProviderResult({
        ok: true,
        status: 'success',
        retryable: false,
        providerType: UPSTREAM_PROVIDER_TYPES.PLATFORM_UPSTREAM,
        supplierName: settings.supplierName,
        requestId,
        responseCode: response.status,
        message: '兑换成功，权益已开通',
        redeemedAt: body.data?.redeemedAt || new Date().toISOString(),
        responseRaw,
        data: body
      })
    }

    if (status === 'invalid') {
      return buildProviderResult({
        ok: false,
        status: 'invalid',
        retryable: false,
        providerType: UPSTREAM_PROVIDER_TYPES.PLATFORM_UPSTREAM,
        supplierName: settings.supplierName,
        requestId,
        responseCode: body.code || response.status,
        message: message || '卡密不存在或已使用',
        responseRaw,
        data: body
      })
    }

    return buildProviderResult({
      ok: false,
      status: 'failed',
      retryable: Boolean(body.retryable),
      providerType: UPSTREAM_PROVIDER_TYPES.PLATFORM_UPSTREAM,
      supplierName: settings.supplierName,
      requestId,
      responseCode: body.code || response.status,
      message: message || '兑换失败，请稍后重试',
      responseRaw,
      data: body
    })
  } catch (error) {
    const responseStatus = error.response?.status
    const responseData = error.response?.data
    const responseRaw = toRawString(responseData || error.message)
    const normalizedStatus = String(responseData?.status || '').trim().toLowerCase()
    const message = String(responseData?.message || responseData?.error || error.message || '').trim()

    return buildProviderResult({
      ok: false,
      status: normalizedStatus === 'invalid' ? 'invalid' : 'failed',
      retryable: normalizedStatus === 'invalid' ? false : true,
      providerType: UPSTREAM_PROVIDER_TYPES.PLATFORM_UPSTREAM,
      supplierName: settings.supplierName,
      requestId,
      responseCode: responseData?.code || responseStatus || 'NETWORK',
      message: message || '兑换失败，请稍后重试',
      responseRaw,
      data: responseData
    })
  }
}

export async function redeemViaUpstreamProvider(payload, options = {}) {
  const settings = options.settings || await getUpstreamSettings()
  const readiness = getUpstreamProviderReadiness(settings, options.providerType || settings.providerType)

  if (!readiness.ready) {
    return buildProviderResult({
      ok: false,
      status: 'failed',
      retryable: false,
      providerType: readiness.providerType,
      supplierName: settings.supplierName,
      requestId: crypto.randomUUID(),
      responseCode: readiness.responseCode,
      message: readiness.message
    })
  }

  if (readiness.providerType === UPSTREAM_PROVIDER_TYPES.PLATFORM_UPSTREAM) {
    return redeemWithPlatformUpstream(settings, payload)
  }

  return redeemWithCustomHttp(settings, payload)
}
