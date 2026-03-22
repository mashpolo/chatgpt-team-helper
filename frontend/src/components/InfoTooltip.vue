<script setup lang="ts">
import { CircleHelp } from 'lucide-vue-next'

withDefaults(defineProps<{
  title?: string
  content: string
  widthClass?: string
}>(), {
  title: '说明',
  widthClass: 'w-72'
})
</script>

<template>
  <span class="relative inline-flex align-middle group">
    <button
      type="button"
      :aria-label="title"
      class="inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-400 transition-colors group-hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-2"
    >
      <CircleHelp class="h-4 w-4" />
    </button>

    <span
      :class="[
        'pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-xl bg-gray-900/95 px-3 py-2 text-left text-[12px] leading-relaxed text-white shadow-xl opacity-0 invisible transition-all duration-200 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100',
        widthClass
      ]"
    >
      <span v-if="title" class="mb-1 block border-b border-white/15 pb-1 text-[11px] font-semibold tracking-wide text-white/80">
        {{ title }}
      </span>
      <span class="block whitespace-pre-line">{{ content }}</span>
      <span class="absolute bottom-[-4px] left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-gray-900/95"></span>
    </span>
  </span>
</template>
