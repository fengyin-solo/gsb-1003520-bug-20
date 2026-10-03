import { MODULE_BY_KEY } from './modules'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 以「当前状态」为唯一口径回填 pending / abnormal：
// 老记录可能没有这两个标记，或标记还是旧逻辑按动作名写出来的，统一按模块状态语义重算，
// 保证总览、列表、归档清单读到的是同一份结论；未登记模块保持原样，兼容任何历史数据。
export function normalizeRows(key: string, rows: unknown): EntryRow[] {
  const meta = MODULE_BY_KEY.get(key)
  if (!Array.isArray(rows)) {
    return []
  }
  const seen = new Set<number>()
  const normalized: EntryRow[] = []
  for (const item of rows) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const raw = item as Record<string, unknown>
    const id = Number(raw.id)
    if (!Number.isFinite(id) || seen.has(id)) {
      // 同一编号只保留首次出现的一条，旧版重复写入的记录在此去重。
      continue
    }
    seen.add(id)
    const status = String(raw.status ?? '')
    const row: EntryRow = { ...(raw as EntryRow), id, status }
    if (meta) {
      row.pending = !meta.closedStatuses.includes(status)
      row.abnormal = meta.abnormalStatuses.includes(status)
    } else {
      row.pending = raw.pending === undefined ? true : Boolean(raw.pending)
      row.abnormal = Boolean(raw.abnormal)
    }
    normalized.push(row)
  }
  normalized.sort((a, b) => a.id - b.id)
  return normalized
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return normalizeBucket(fallback)
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = normalizeBucket(fallback)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    const seeded = normalizeBucket(fallback)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  // 历史数据按模块整体保存：storage 里出现过的模块以其存量记录为准（保留全部旧记录，
  // 只做回填/去重，不拿示例数据覆盖）；只有 storage 里没有的模块才用示例数据补齐。
  const merged: Record<string, unknown> = { ...parsed }
  for (const [key, rows] of Object.entries(clone(SEED_ROWS))) {
    if (!(key in merged)) {
      merged[key] = rows
    }
  }
  return normalizeBucket(merged)
}

function normalizeBucket(bucket: Record<string, unknown>): Record<string, EntryRow[]> {
  const result: Record<string, EntryRow[]> = {}
  for (const [key, rows] of Object.entries(bucket)) {
    result[key] = normalizeRows(key, rows)
  }
  return result
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  commitBucket({ ...allRows(), [key]: normalizeRows(key, rows) })
}

// 单次动作只落一份数据：先序列化再整体写入，任一环节失败都恢复内存与 localStorage，
// 总览、列表、归档清单要么一起更新，要么一起回退，不会出现只改了一半的结果。
function commitBucket(next: Record<string, EntryRow[]>): void {
  const previousCache = cache
  const previousRaw =
    typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(STORAGE_KEY)
      : null
  const payload = JSON.stringify(next)
  cache = next
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, payload)
    }
  } catch (error) {
    cache = previousCache
    if (typeof window !== 'undefined' && window.localStorage) {
      if (previousRaw === null) {
        window.localStorage.removeItem(STORAGE_KEY)
      } else {
        window.localStorage.setItem(STORAGE_KEY, previousRaw)
      }
    }
    throw error
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return listRows(key)
}

export function storageKey(): string {
  return STORAGE_KEY
}
