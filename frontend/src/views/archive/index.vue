<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>归档清单</h2>
        <p class="page-desc">只收录已办结的记录：同一记录在清单中只保留一条最新结果，撤销、停用、驳回等反向办结同样归档且标注异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">重新统计</button>
      </div>
    </header>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>业务模块</span>
        <select v-model="moduleKey">
          <option value="">全部模块</option>
          <option v-for="meta in modules" :key="meta.key" :value="meta.key">{{ meta.name }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>关键字</span>
        <input v-model="keyword" placeholder="按编号/状态检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>记录编号</th><th>办结状态</th><th>异常标记</th><th>办结动作</th><th>归档时间</th></tr>
      </thead>
      <tbody>
        <tr v-for="entry in items" :key="`${entry.module}:${entry.id}`">
          <td>{{ moduleName(entry.module) }}</td>
          <td>{{ displayCode(entry) }}</td>
          <td>{{ entry.status }}</td>
          <td>
            <span :class="entry.abnormal ? 'tag tag-abnormal' : 'tag tag-normal'">
              {{ entry.abnormal ? '异常' : '正常' }}
            </span>
          </td>
          <td>{{ entry.action }}</td>
          <td>{{ formatTime(entry.archivedAt) }}</td>
        </tr>
        <tr v-if="!items.length">
          <td colspan="6" class="empty-state">暂无已办结记录，处置完成后会自动归档</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条归档记录，与各模块列表的办结记录、运营概览汇总保持一致</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

import { listArchive, onStoreChange } from '@/api/local-service'
import { MODULES } from '@/data/modules'
import type { ArchiveEntry } from '@/data/types'

const modules = MODULES
const moduleKey = ref('')
const keyword = ref('')
const items = ref<ArchiveEntry[]>([])
const total = ref(0)
const errorMessage = ref('')
let unsubscribe: (() => void) | null = null

const MODULE_BY_NAME = new Map(MODULES.map((meta) => [meta.key, meta.name]))

function moduleName(key: string): string {
  return MODULE_BY_NAME.get(key) ?? key
}

// 归档页展示用编号：优先取各模块的业务编号字段，取不到时用内部 id。
function displayCode(entry: ArchiveEntry): string {
  const meta = MODULES.find((item) => item.key === entry.module)
  const codeField = meta?.fields[0]
  const code = codeField ? entry.row[codeField] : ''
  return code ? String(code) : `#${entry.id}`
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function resetFilters() {
  moduleKey.value = ''
  keyword.value = ''
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listArchive(moduleKey.value)
    const word = keyword.value.trim()
    items.value =
      word === ''
        ? payload.items
        : payload.items.filter(
            (entry) =>
              entry.status.includes(word) ||
              displayCode(entry).includes(word) ||
              entry.action.includes(word),
          )
    total.value = items.value.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '归档清单读取失败'
  }
}

onMounted(() => {
  reload()
  // 任一模块动作事务提交成功后，归档清单随同一结果即时刷新。
  unsubscribe = onStoreChange(reload)
})

onUnmounted(() => {
  unsubscribe?.()
})
</script>

<style scoped>
.tag {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 10px;
  font-size: 12px;
}
.tag-normal {
  background: #e7f6ec;
  color: #1a7f37;
}
.tag-abnormal {
  background: #fdecec;
  color: #b42318;
}
.filter-item select {
  padding: 4px 8px;
}
</style>
