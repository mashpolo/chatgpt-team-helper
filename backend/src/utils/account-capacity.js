const toSafeCount = (value) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.floor(parsed)
}

export const GPT_ACCOUNT_REDEMPTION_CAPACITY = 5

export const getAccountOccupancy = ({ userCount, inviteCount } = {}) => (
  toSafeCount(userCount) + toSafeCount(inviteCount)
)

export const getAvailableRedemptionCodeSlots = ({
  userCount,
  inviteCount,
  unusedCodesCount,
  totalCapacity = GPT_ACCOUNT_REDEMPTION_CAPACITY
} = {}) => {
  const normalizedCapacity = toSafeCount(totalCapacity) || GPT_ACCOUNT_REDEMPTION_CAPACITY
  const occupancy = getAccountOccupancy({ userCount, inviteCount })
  const pendingCodes = toSafeCount(unusedCodesCount)
  return Math.max(0, normalizedCapacity - occupancy - pendingCodes)
}
