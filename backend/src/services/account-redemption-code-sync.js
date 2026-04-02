import { getAvailableRedemptionCodeSlots } from '../utils/account-capacity.js'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const generateRedemptionCode = (length = 12) => {
  let code = ''
  for (let index = 0; index < length; index += 1) {
    code += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length))
    if ((index + 1) % 4 === 0 && index < length - 1) {
      code += '-'
    }
  }
  return code
}

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase()

const countUnusedCodesByAccount = (db, accountEmail) => {
  const normalizedEmail = normalizeEmail(accountEmail)
  if (!db || !normalizedEmail) return 0

  const result = db.exec(
    `
      SELECT COUNT(*)
      FROM redemption_codes
      WHERE lower(trim(account_email)) = ?
        AND COALESCE(is_redeemed, 0) = 0
    `,
    [normalizedEmail]
  )

  return Number(result[0]?.values?.[0]?.[0] || 0)
}

const listRemovableUnusedCodes = (db, accountEmail, limit = 0) => {
  const normalizedEmail = normalizeEmail(accountEmail)
  const normalizedLimit = Math.max(0, Number(limit) || 0)
  if (!db || !normalizedEmail || !normalizedLimit) return []

  const result = db.exec(
    `
      SELECT id, code
      FROM redemption_codes
      WHERE lower(trim(account_email)) = ?
        AND COALESCE(is_redeemed, 0) = 0
        AND COALESCE(is_downstream_sold, 0) = 0
        AND (reserved_for_uid IS NULL OR trim(reserved_for_uid) = '')
        AND (reserved_for_order_no IS NULL OR trim(reserved_for_order_no) = '')
        AND (reserved_for_entry_id IS NULL OR reserved_for_entry_id = 0)
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT ?
    `,
    [normalizedEmail, normalizedLimit]
  )

  const rows = result[0]?.values || []
  return rows.map(row => ({
    id: Number(row[0]),
    code: String(row[1] || '')
  }))
}

const createCodesForAccount = (db, accountEmail, count) => {
  const normalizedEmail = normalizeEmail(accountEmail)
  const normalizedCount = Math.max(0, Number(count) || 0)
  if (!db || !normalizedEmail || !normalizedCount) return []

  const createdCodes = []

  for (let index = 0; index < normalizedCount; index += 1) {
    let code = generateRedemptionCode()
    let attempts = 0
    let success = false

    while (attempts < 5 && !success) {
      try {
        db.run(
          `
            INSERT INTO redemption_codes (code, account_email, created_at, updated_at)
            VALUES (?, ?, DATETIME('now', 'localtime'), DATETIME('now', 'localtime'))
          `,
          [code, normalizedEmail]
        )
        createdCodes.push(code)
        success = true
      } catch (error) {
        if (String(error?.message || '').includes('UNIQUE')) {
          code = generateRedemptionCode()
          attempts += 1
          continue
        }
        throw error
      }
    }
  }

  return createdCodes
}

export const reconcileAccountRedemptionCodes = (db, { accountEmail, userCount, inviteCount } = {}) => {
  const normalizedEmail = normalizeEmail(accountEmail)
  if (!db || !normalizedEmail) {
    return {
      generatedCodes: [],
      removedCodes: [],
      generatedCount: 0,
      removedCount: 0,
      targetUnusedCount: 0,
      actualUnusedCount: 0,
      overflowCount: 0,
      warning: '账号邮箱为空，已跳过兑换码对齐'
    }
  }

  const currentUnusedCount = countUnusedCodesByAccount(db, normalizedEmail)
  const targetUnusedCount = getAvailableRedemptionCodeSlots({
    userCount,
    inviteCount,
    unusedCodesCount: 0
  })

  const generatedCodes = []
  const removedCodes = []
  let warning = ''

  if (currentUnusedCount < targetUnusedCount) {
    generatedCodes.push(...createCodesForAccount(db, normalizedEmail, targetUnusedCount - currentUnusedCount))
  } else if (currentUnusedCount > targetUnusedCount) {
    const removable = listRemovableUnusedCodes(db, normalizedEmail, currentUnusedCount - targetUnusedCount)
    for (const item of removable) {
      db.run('DELETE FROM redemption_codes WHERE id = ?', [item.id])
      removedCodes.push(item.code)
    }
  }

  const actualUnusedCount = countUnusedCodesByAccount(db, normalizedEmail)
  const overflowCount = Math.max(0, actualUnusedCount - targetUnusedCount)

  if (overflowCount > 0) {
    warning = `仍有 ${overflowCount} 个未兑换码因已预留或已售出，未自动回收`
  }

  return {
    generatedCodes,
    removedCodes,
    generatedCount: generatedCodes.length,
    removedCount: removedCodes.length,
    targetUnusedCount,
    actualUnusedCount,
    overflowCount,
    warning
  }
}
