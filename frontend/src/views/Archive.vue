<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>归档清单</h2>
        <p class="page-desc">汇总各业务模块已到终态的记录，与运营概览、模块列表共用同一份数据。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">重新加载</button>
      </div>
    </header>
    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">归档记录</span>
        <strong class="stat-value">{{ rows.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">其中异常</span>
        <strong class="stat-value">{{ abnormalCount }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>业务模块</span>
        <input v-model="filters.moduleName" placeholder="按业务模块检索" />
      </label>
      <label class="filter-item">
        <span>编号</span>
        <input v-model="filters.code" placeholder="按编号检索" />
      </label>
      <label class="filter-item">
        <span>当前状态</span>
        <input v-model="filters.status" placeholder="按状态检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>编号</th><th>当前状态</th><th>异常</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="`${row.module}-${row.id}`">
          <td>{{ row.moduleName }}</td>
          <td>{{ row.code }}</td>
          <td>{{ row.status }}</td>
          <td>{{ row.abnormal ? '是' : '否' }}</td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="4" class="empty-state">暂无已归档记录，记录流转到终态后会出现在这里</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>同一记录只保留最新一条，撤销、驳回等动作按最新状态归档</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { listArchive } from '@/api/local-service'
import type { ArchiveRow } from '@/data/types'

const rows = ref<ArchiveRow[]>([])
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const abnormalCount = computed(() => rows.value.filter((row) => row.abnormal).length)

function resetFilters() {
  filters.value = {}
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    rows.value = listArchive(filters.value)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '归档清单读取失败'
  }
}

onMounted(reload)
</script>
