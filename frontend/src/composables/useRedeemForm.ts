import { computed, ref, unref, type Ref } from 'vue'
import { redemptionCodeService } from '@/services/api'
import { EMAIL_REGEX } from '@/lib/validation'

export interface RedeemSuccessInfo {
  message?: string
  email?: string | null
  accountEmail?: string | null
  userCount?: number | null
  inviteStatus?: string
  fulfillmentMode?: string | null
  supplierName?: string | null
  supplierStatus?: string | null
  redeemedAt?: string | null
}

type MaybeRef<T> = T | Ref<T>
type UseRedeemFormOptions = {
  rawCodeMode?: MaybeRef<boolean>
}

export const useRedeemForm = (channel: MaybeRef<string> = 'common', options: UseRedeemFormOptions = {}) => {
  const redeemChannel = computed(() => {
    const raw = String(unref(channel) ?? '').trim().toLowerCase()
    return raw || 'common'
  })
  const rawCodeMode = computed(() => Boolean(unref(options.rawCodeMode)))
  const formData = ref({
    email: '',
    code: '',
  })

  const isLoading = ref(false)
  const errorMessage = ref('')
  const successInfo = ref<RedeemSuccessInfo | null>(null)

  const isValidEmail = computed(() => {
    const email = formData.value.email.trim()
    if (!email) return true
    return EMAIL_REGEX.test(email)
  })

  const isValidCode = computed(() => {
    if (!formData.value.code) return true
    if (rawCodeMode.value) {
      return formData.value.code.trim().length > 0
    }
    const codeRegex = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
    return codeRegex.test(formData.value.code)
  })

  const handleCodeInput = (value: string | Event) => {
    let val = ''
    if (typeof value === 'string') {
      val = value
    } else {
      val = (value.target as HTMLInputElement).value
    }

    if (rawCodeMode.value) {
      formData.value.code = val
      return
    }

    let formatted = val.toUpperCase().replace(/[^A-Z0-9]/g, '')

    if (formatted.length > 4 && formatted.length <= 8) {
      formatted = `${formatted.slice(0, 4)}-${formatted.slice(4)}`
    } else if (formatted.length > 8) {
      formatted = `${formatted.slice(0, 4)}-${formatted.slice(4, 8)}-${formatted.slice(8, 12)}`
    }

    if (formatted.length > 14) {
      formatted = formatted.slice(0, 14)
    }

    formData.value.code = formatted
  }

  const handleRedeem = async (options?: { extraData?: Record<string, any>; linuxDoSessionToken?: string }) => {
    errorMessage.value = ''
    successInfo.value = null

    const normalizedEmail = formData.value.email.trim()

    if (!normalizedEmail) {
      console.debug('[RedeemForm] email missing before submit', { rawEmail: formData.value.email })
      errorMessage.value = '请输入邮箱地址'
      return
    }

    if (!isValidEmail.value) {
      console.debug('[RedeemForm] invalid email format', {
        rawEmail: formData.value.email,
        normalizedEmail
      })
      errorMessage.value = '请输入有效的邮箱地址'
      return
    }

    if (!formData.value.code) {
      errorMessage.value = rawCodeMode.value ? '请输入卡密' : '请输入兑换码'
      return
    }

    if (!isValidCode.value) {
      errorMessage.value = rawCodeMode.value
        ? '请输入有效卡密'
        : '兑换码格式不正确，应为 XXXX-XXXX-XXXX 格式'
      return
    }

    isLoading.value = true

    try {
      const payload: Record<string, any> = {
        email: normalizedEmail,
        code: formData.value.code.trim(),
        channel: redeemChannel.value,
      }

      if (options?.extraData) {
        Object.assign(payload, options.extraData)
      }

      console.debug('[RedeemForm] submitting redeem request', {
        email: payload.email,
        channel: payload.channel,
        hasCode: !!payload.code,
        hasExtraData: !!options?.extraData
      })

      const response = await redemptionCodeService.redeem(
        payload as { email: string; code: string; channel?: string; redeemerUid?: string },
        options?.linuxDoSessionToken ? { linuxDoSessionToken: options.linuxDoSessionToken } : undefined
      )

      const responseData = response.data?.data || {}
      const resolvedUserCount = Number(responseData.userCount)
      successInfo.value = {
        message: String(responseData.message || response.data?.message || '兑换成功').trim(),
        email: responseData.email || normalizedEmail,
        accountEmail: responseData.accountEmail || null,
        userCount: Number.isFinite(resolvedUserCount) ? resolvedUserCount : null,
        inviteStatus: responseData.inviteStatus,
        fulfillmentMode: responseData.fulfillmentMode || null,
        supplierName: responseData.supplierName || null,
        supplierStatus: responseData.supplierStatus || null,
        redeemedAt: responseData.redeemedAt || null,
      }

      formData.value = {
        email: '',
        code: '',
      }
    } catch (error: any) {
      if (error.response?.data?.message) {
        errorMessage.value = error.response.data.message
      } else if (error.response?.status === 404) {
        errorMessage.value = rawCodeMode.value ? '卡密不存在或已被使用' : '兑换码不存在或已被使用'
      } else if (error.response?.status === 400) {
        errorMessage.value = '请求参数错误，请检查输入'
      } else if (error.response?.status === 503) {
        errorMessage.value = rawCodeMode.value ? '兑换服务暂不可用，请稍后重试' : '暂无可用账号，请稍后再试'
      } else {
        errorMessage.value = '网络错误，请稍后重试'
      }
    } finally {
      isLoading.value = false
    }
  }

  return {
    formData,
    isLoading,
    errorMessage,
    successInfo,
    isValidEmail,
    isValidCode,
    handleCodeInput,
    handleRedeem,
  }
}
