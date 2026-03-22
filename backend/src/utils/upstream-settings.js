import { getDatabase } from '../database/init.js'

const CONFIG_KEYS = [
  'upstream_provider_enabled',
  'upstream_provider_type',
  'upstream_supplier_name',
  'upstream_base_url',
  'upstream_custom_url',
  'upstream_custom_body_template',
  'upstream_outbound_api_key',
  'upstream_timeout_ms',
  'upstream_api_enabled',
  'upstream_api_key'
]

const DEFAULT_CUSTOM_BODY_TEMPLATE = JSON.stringify({
  userEmail: '{{email}}',
  cardCode: '{{code}}'
}, null, 2)

const DEFAULTS = {
  providerEnabled: false,
  providerType: 'custom-http',
  supplierName: '',
  baseUrl: '',
  customUrl: '',
  customBodyTemplate: DEFAULT_CUSTOM_BODY_TEMPLATE,
  outboundApiKey: '',
  timeoutMs: 15000,
  apiEnabled: false,
  apiKey: ''
}

const CACHE_TTL_MS = 60 * 1000
let cachedSettings = null
let cachedAt = 0

const parseBool = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'boolean') return value
  const normalized = String(value).trim().toLowerCase()
  if (!normalized) return fallback
  return ['true', '1', 'yes', 'y', 'on'].includes(normalized)
}

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const clampInteger = (value, { min, max, fallback }) => {
  const parsed = toInt(value, fallback)
  const normalized = Number.isFinite(parsed) ? parsed : fallback
  return Math.min(max, Math.max(min, normalized))
}

const normalizeBaseUrl = (value) => {
  const raw = String(value || '').trim()
  return raw.replace(/\/+$/, '')
}

const normalizeProviderType = (value, fallback = DEFAULTS.providerType) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return fallback
  if (normalized === 'legacy-http') return 'custom-http'
  if (normalized === 'custom-http' || normalized === 'platform-upstream') return normalized
  return fallback
}

const loadSystemConfigMap = (database, keys) => {
  if (!database) return new Map()
  const list = Array.isArray(keys) && keys.length ? keys : CONFIG_KEYS
  const placeholders = list.map(() => '?').join(',')
  const result = database.exec(
    `SELECT config_key, config_value FROM system_config WHERE config_key IN (${placeholders})`,
    list
  )
  const map = new Map()
  const rows = result[0]?.values || []
  for (const row of rows) {
    map.set(String(row?.[0] ?? ''), String(row?.[1] ?? ''))
  }
  return map
}

export const getUpstreamSettingsFromEnv = () => ({
  providerEnabled: parseBool(process.env.UPSTREAM_PROVIDER_ENABLED, DEFAULTS.providerEnabled),
  providerType: normalizeProviderType(process.env.UPSTREAM_PROVIDER_TYPE, DEFAULTS.providerType),
  supplierName: String(process.env.UPSTREAM_SUPPLIER_NAME || DEFAULTS.supplierName).trim(),
  baseUrl: normalizeBaseUrl(process.env.UPSTREAM_BASE_URL || DEFAULTS.baseUrl),
  customUrl: String(process.env.UPSTREAM_CUSTOM_URL || '').trim(),
  customBodyTemplate: String(process.env.UPSTREAM_CUSTOM_BODY_TEMPLATE || DEFAULTS.customBodyTemplate),
  outboundApiKey: String(process.env.UPSTREAM_OUTBOUND_API_KEY || DEFAULTS.outboundApiKey).trim(),
  timeoutMs: clampInteger(process.env.UPSTREAM_TIMEOUT_MS, { min: 1000, max: 120000, fallback: DEFAULTS.timeoutMs }),
  apiEnabled: parseBool(process.env.UPSTREAM_API_ENABLED, DEFAULTS.apiEnabled),
  apiKey: String(process.env.UPSTREAM_API_KEY || DEFAULTS.apiKey).trim()
})

export const invalidateUpstreamSettingsCache = () => {
  cachedSettings = null
  cachedAt = 0
}

export async function getUpstreamSettings(db, { forceRefresh = false } = {}) {
  const now = Date.now()
  if (!forceRefresh && cachedSettings && now - cachedAt < CACHE_TTL_MS) {
    return cachedSettings
  }

  const database = db || (await getDatabase())
  const stored = loadSystemConfigMap(database, CONFIG_KEYS)
  const env = getUpstreamSettingsFromEnv()

  const resolveString = (key, fallback) => {
    if (!stored.has(key)) return fallback
    return String(stored.get(key) ?? '')
  }

  const providerEnabled = parseBool(resolveString('upstream_provider_enabled', env.providerEnabled), env.providerEnabled)
  const providerType = normalizeProviderType(resolveString('upstream_provider_type', env.providerType), env.providerType)
  const supplierName = String(resolveString('upstream_supplier_name', env.supplierName) ?? '').trim()
  const baseUrl = normalizeBaseUrl(resolveString('upstream_base_url', env.baseUrl))
  const customUrl = stored.has('upstream_custom_url')
    ? String(stored.get('upstream_custom_url') ?? '').trim()
    : String(env.customUrl || '').trim()
  const customBodyTemplate = stored.has('upstream_custom_body_template')
    ? String(stored.get('upstream_custom_body_template') ?? '')
    : String(env.customBodyTemplate || DEFAULTS.customBodyTemplate)
  const outboundApiKey = String(resolveString('upstream_outbound_api_key', env.outboundApiKey) ?? '').trim()
  const timeoutMs = clampInteger(resolveString('upstream_timeout_ms', env.timeoutMs), {
    min: 1000,
    max: 120000,
    fallback: env.timeoutMs
  })
  const apiEnabled = parseBool(resolveString('upstream_api_enabled', env.apiEnabled), env.apiEnabled)
  const apiKey = String(resolveString('upstream_api_key', env.apiKey) ?? '').trim()

  cachedSettings = {
    providerEnabled,
    providerType,
    supplierName,
    baseUrl,
    customUrl,
    customBodyTemplate,
    outboundApiKey,
    timeoutMs,
    apiEnabled,
    apiKey,
    stored: {
      providerEnabled: stored.has('upstream_provider_enabled'),
      providerType: stored.has('upstream_provider_type'),
      supplierName: stored.has('upstream_supplier_name'),
      baseUrl: stored.has('upstream_base_url'),
      customUrl: stored.has('upstream_custom_url'),
      customBodyTemplate: stored.has('upstream_custom_body_template'),
      outboundApiKey: stored.has('upstream_outbound_api_key') && Boolean(String(stored.get('upstream_outbound_api_key') ?? '').trim()),
      timeoutMs: stored.has('upstream_timeout_ms'),
      apiEnabled: stored.has('upstream_api_enabled'),
      apiKey: stored.has('upstream_api_key') && Boolean(String(stored.get('upstream_api_key') ?? '').trim())
    }
  }
  cachedAt = now
  return cachedSettings
}
