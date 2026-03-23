<template>
  <RedeemShell :maxWidth="'max-w-[560px]'">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <RouterLink
        to="/downstream/order"
        class="inline-flex items-center gap-2 rounded-full bg-white/60 dark:bg-white/10 backdrop-blur-xl border border-white/40 dark:border-white/10 px-4 py-2 text-[13px] font-medium text-[#007AFF] hover:text-[#005FCC] transition-colors"
      >
        查询订单
      </RouterLink>

      <div
        class="inline-flex items-center gap-2.5 rounded-full bg-white/60 dark:bg-white/10 backdrop-blur-xl border border-white/40 dark:border-white/10 px-4 py-1.5 shadow-sm"
      >
        <span class="relative flex h-2.5 w-2.5">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#34C759]"></span>
        </span>
        <span class="text-[13px] font-medium text-gray-600 dark:text-gray-300 tracking-wide">
          可售库存 · {{ meta?.availableCount ?? '...' }} 张
        </span>
      </div>
    </div>

    <div v-if="pageError" class="rounded-2xl border border-red-200/70 bg-red-50/60 p-4 text-sm text-red-700">
      {{ pageError }}
    </div>

    <div
      v-if="meta && !meta.enabled"
      class="rounded-2xl border border-amber-200/70 bg-amber-50/70 p-5 text-sm text-amber-700"
    >
      下游售码暂未开启，请联系管理员。
    </div>

    <div v-else-if="meta" class="relative group perspective-1000">
      <div
        class="absolute -inset-1 bg-gradient-to-r from-emerald-500 via-cyan-500 to-sky-600 rounded-[2rem] blur opacity-25 group-hover:opacity-40 transition duration-700"
      ></div>
      <AppleCard
        variant="glass"
        className="relative overflow-hidden shadow-2xl shadow-black/10 border border-white/40 dark:border-white/10 ring-1 ring-black/5 backdrop-blur-3xl transition-all duration-500 hover:shadow-3xl hover:scale-[1.01]"
      >
        <div class="p-6 sm:p-7 space-y-6">
          <div class="grid gap-3">
            <div class="rounded-2xl bg-white/50 dark:bg-black/20 border border-black/5 dark:border-white/10 p-5">
              <p class="text-[13px] text-[#86868b]">商品</p>
              <p class="mt-1 text-[24px] leading-tight font-extrabold text-[#1d1d1f] dark:text-white">
                {{ meta.productName }}
              </p>
            </div>

            <div class="rounded-2xl border border-emerald-200/70 bg-emerald-50/70 p-4">
              <p class="text-[13px] text-emerald-700/80">统一单价</p>
              <p class="mt-2 text-[30px] leading-none font-extrabold tabular-nums text-emerald-900">
                ¥ {{ meta.amount }}
              </p>
            </div>
          </div>

          <form class="space-y-6" @submit.prevent="handleSubmit">
            <AppleInput
              v-model.trim="email"
              label="联系方式"
              placeholder="name@example.com"
              type="email"
              variant="filled"
              :disabled="loading || isSoldOut"
              :error="emailError"
            />

            <AppleInput
              v-model="quantityInput"
              label="批发数量"
              placeholder="1"
              type="number"
              variant="filled"
              :disabled="loading || isSoldOut"
              :error="quantityError"
            />

            <div class="rounded-2xl bg-white/60 dark:bg-black/20 border border-black/5 dark:border-white/10 p-5">
              <div class="flex items-center justify-between gap-4">
                <div>
                  <p class="text-[13px] text-[#86868b]">订单总价</p>
                  <p class="mt-1 text-[28px] font-extrabold tabular-nums text-[#1d1d1f] dark:text-white">
                    ¥ {{ totalAmount }}
                  </p>
                </div>
                <div class="text-right text-sm text-[#86868b]">
                  <p>数量：{{ normalizedQuantity }}</p>
                  <p>库存：{{ meta.availableCount }}</p>
                  <p>单笔上限：{{ maxOrderQuantity }}</p>
                </div>
              </div>
            </div>

            <div v-if="availablePayTypes.length > 1" class="space-y-3">
              <p class="text-[13px] font-semibold text-[#86868b] uppercase tracking-wider">支付方式</p>
              <div class="grid grid-cols-2 gap-3">
                <button
                  v-for="method in availablePayTypes"
                  :key="method"
                  type="button"
                  class="rounded-2xl border px-4 py-3 text-sm font-medium transition-all"
                  :class="selectedPayType === method ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white/60 text-gray-600 hover:border-gray-300'"
                  :disabled="loading || isSoldOut"
                  @click="selectedPayType = method"
                >
                  {{ payTypeLabel(method) }}
                </button>
              </div>
            </div>

            <div v-else class="rounded-2xl border border-[#1677FF]/15 bg-[#1677FF]/6 px-4 py-3 text-sm font-medium text-[#1677FF]">
              支付方式：{{ payTypeLabel(selectedPayType) }}
            </div>

            <AppleButton
              type="submit"
              variant="primary"
              size="lg"
              class="w-full h-[50px]"
              :loading="loading"
              :disabled="loading || isSoldOut || !!emailError || !!quantityError"
            >
              {{ isSoldOut ? '库存不足' : (loading ? '正在创建订单...' : '下单') }}
            </AppleButton>
          </form>
        </div>
      </AppleCard>
    </div>
  </RedeemShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import RedeemShell from '@/components/RedeemShell.vue'
import AppleCard from '@/components/ui/apple/Card.vue'
import AppleInput from '@/components/ui/apple/Input.vue'
import AppleButton from '@/components/ui/apple/Button.vue'
import { downstreamService, type DownstreamMeta } from '@/services/api'
import { EMAIL_REGEX } from '@/lib/validation'

const router = useRouter()

const meta = ref<DownstreamMeta | null>(null)
const email = ref('')
const quantityInput = ref<string | number>('1')
const loading = ref(false)
const pageError = ref('')
const selectedPayType = ref<'alipay' | 'wxpay'>('alipay')
const submitAttempted = ref(false)

const payTypeLabel = (value?: string) => value === 'wxpay' ? '微信支付' : '支付宝'
const availablePayTypes = computed(() => {
  const methods = Array.isArray(meta.value?.payMethods) ? meta.value?.payMethods.filter(method => method === 'alipay' || method === 'wxpay') : []
  if (methods.length > 0) return methods as Array<'alipay' | 'wxpay'>
  const fallback = []
  if (meta.value?.payAlipayEnabled !== false) fallback.push('alipay')
  if (meta.value?.payWxpayEnabled) fallback.push('wxpay')
  return fallback as Array<'alipay' | 'wxpay'>
})

const normalizedQuantityInput = computed(() => String(quantityInput.value ?? '').trim())

const normalizedQuantity = computed(() => {
  const parsed = Number.parseInt(normalizedQuantityInput.value || '1', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
})

const maxOrderQuantity = computed(() => Math.max(1, Number(meta.value?.maxOrderQuantity || 20)))

const totalAmount = computed(() => {
  const unit = Number(meta.value?.amount || 0)
  if (!Number.isFinite(unit) || unit <= 0) return '0.00'
  return (unit * normalizedQuantity.value).toFixed(2)
})

const isValidEmail = computed(() => {
  if (!email.value) return true
  return EMAIL_REGEX.test(email.value.trim())
})

const emailError = computed(() => {
  const normalizedEmail = email.value.trim()
  if (!normalizedEmail) return submitAttempted.value ? '请输入联系方式' : ''
  return isValidEmail.value ? '' : '请输入有效的邮箱格式'
})

const isSoldOut = computed(() => Number(meta.value?.availableCount || 0) <= 0)

const quantityError = computed(() => {
  const raw = normalizedQuantityInput.value
  const parsed = Number.parseInt(raw || '0', 10)
  if (!raw) return '请输入购买数量'
  if (!Number.isFinite(parsed) || parsed <= 0) return '请输入大于 0 的整数数量'
  if (parsed > maxOrderQuantity.value) {
    return `单笔最多购买 ${maxOrderQuantity.value} 个`
  }
  if (parsed > Number(meta.value?.availableCount || 0) && !isSoldOut.value) {
    return '数量超过当前可售库存'
  }
  return ''
})

const loadMeta = async ({ preservePageError = false }: { preservePageError?: boolean } = {}) => {
  if (!preservePageError) {
    pageError.value = ''
  }
  try {
    meta.value = await downstreamService.getMeta()
    if (availablePayTypes.value.length > 0 && !availablePayTypes.value.includes(selectedPayType.value)) {
      selectedPayType.value = availablePayTypes.value[0] || 'alipay'
    }
    const maxAllowedQuantity = Math.max(
      1,
      Math.min(
        Number(meta.value?.availableCount || 1),
        Number(meta.value?.maxOrderQuantity || 20)
      )
    )
    if (normalizedQuantity.value > maxAllowedQuantity) {
      quantityInput.value = String(maxAllowedQuantity)
    }
  } catch (error: any) {
    pageError.value = error?.response?.data?.error || '加载下游售码信息失败，请稍后重试'
  }
}

const handleSubmit = async () => {
  submitAttempted.value = true
  pageError.value = ''
  const normalizedEmail = email.value.trim()
  if (emailError.value) {
    return
  }
  if (!meta.value?.enabled) {
    pageError.value = '下游售码暂未开启'
    return
  }
  if (availablePayTypes.value.length <= 0) {
    pageError.value = '当前暂无可用支付方式'
    return
  }
  if (isSoldOut.value) {
    pageError.value = '可用库存不足，请稍后再试'
    return
  }
  if (quantityError.value) {
    return
  }

  loading.value = true
  try {
    const order = await downstreamService.createOrder({
      email: normalizedEmail,
      type: selectedPayType.value,
      quantity: normalizedQuantity.value,
    })
    await router.push({
      path: '/downstream/order',
      query: {
        orderNo: order.orderNo,
        email: normalizedEmail,
      }
    })
  } catch (error: any) {
    pageError.value = error?.response?.data?.error || '创建订单失败，请稍后重试'
    await loadMeta({ preservePageError: true })
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadMeta()
})
</script>
