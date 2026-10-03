import { MODULE_BY_KEY, MODULES } from './modules'
import { SEED_ROWS } from './seed'
import type { ArchiveEntry, EntryRow, ModuleMeta, OverviewResult } from './types'

// 本地持久化：业务行、归档清单、总览快照放在同一个 localStorage 信封里，
// 一次动作要么整封写进去，要么整体回退，保证三处取数始终指向同一结果。
const STORAGE_KEY = 'hydrology-monitor-station:store:v2'
// 旧版本只存行数据，迁移时读取一次后删除，避免新老两份数据漂移。
const LEGACY_STORAGE_KEY = 'hydrology-monitor-station:entries'
const STORE_VERSION = 2

export type StoreState = {
  rows: Record<string, EntryRow[]>
  archive: ArchiveEntry[]
  overview: OverviewResult
  version: number
}

type ChangeListener = () => void

const ABNORMAL_KEYWORDS = ['异常', '故障', '超标', '不合格', '中断', '驳回', '撤销', '废止', '停用', '重测', '更换']
const CLOSED_KEYWORDS = ['已通过', '已校核', '已合格', '已处置', '已验收', '已完成', '已刊印', '已批准', '已修订', '已生效', '已调整', '已出报告', '已复核', '汛期加强', '异常值', '已撤销', '已停用', '已驳回', '已废止', '需重测', '待更换', '不合格', '暂停运行']

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 「是否办结/是否异常」只认当前状态：模块元数据显式登记，旧记录或未登记状态再用状态名兜底。
export function isClosedStatus(meta: ModuleMeta | undefined, status: string): boolean {
  if (meta) {
    return meta.closedStatuses.includes(status)
  }
  return CLOSED_KEYWORDS.some((word) => status.includes(word))
}

export function isAbnormalStatus(meta: ModuleMeta | undefined, status: string): boolean {
  if (meta) {
    return meta.abnormalStatuses.includes(status)
  }
  return ABNORMAL_KEYWORDS.some((word) => status.includes(word))
}

// 历史数据可能没有 pending/abnormal，也可能与当前状态对不上。
// 统一按「当前状态 + 模块登记口径」回填，旧标记只在状态名无法识别时兜底，兼容所有旧记录。
export function normalizeRow(moduleKey: string, row: Partial<EntryRow>): EntryRow {
  const meta = MODULE_BY_KEY.get(moduleKey)
  const status = String(row.status ?? '')
  const pending = !isClosedStatus(meta, status)
  const abnormal = isAbnormalStatus(meta, status)
  return {
    ...(row as EntryRow),
    id: Number(row.id),
    status,
    pending,
    abnormal,
  }
}

function seedState(): Record<string, EntryRow[]> {
  const rows: Record<string, EntryRow[]> = {}
  for (const meta of MODULES) {
    rows[meta.key] = (SEED_ROWS[meta.key] ?? []).map((row) => normalizeRow(meta.key, row))
  }
  return rows
}

// 归档清单不单独追加动作记录，而是从「当前处于办结状态的行」整体对账得出：
// 新进入终态的 upsert 一条（同模块同 id 原地更新），离开终态或记录消失的剔除。
// 因此同一记录连续/反复动作在清单里永远只有一条，不会残留旧快照。
function reconcileArchive(
  rows: Record<string, EntryRow[]>,
  previous: ArchiveEntry[] = [],
  action?: { module: string; id: number; action: string },
): ArchiveEntry[] {
  const now = new Date().toISOString()
  const previousMap = new Map(previous.map((entry) => [`${entry.module}:${entry.id}`, entry]))
  const next: ArchiveEntry[] = []
  for (const meta of MODULES) {
    for (const row of rows[meta.key] ?? []) {
      if (!isClosedStatus(meta, String(row.status))) {
        continue
      }
      const key = `${meta.key}:${row.id}`
      const old = previousMap.get(key)
      const isActor = action && action.module === meta.key && action.id === Number(row.id)
      next.push({
        module: meta.key,
        id: Number(row.id),
        status: String(row.status),
        abnormal: row.abnormal,
        // 本次动作把该记录送进/推到新办结态时用动作名；
        // 其它已归档记录（无论状态是否变化）都沿用原动作与时间，原地更新不刷新。
        action: isActor ? action!.action : old?.action ?? '状态办结',
        archivedAt: old?.archivedAt ?? now,
        row: clone(row),
      })
    }
  }
  // 稳定排序：按模块、编号，便于清单展示与测试。
  next.sort((a, b) => (a.module === b.module ? a.id - b.id : a.module.localeCompare(b.module)))
  return next
}

export function computeOverview(rows: Record<string, EntryRow[]>): OverviewResult {
  const modules = MODULES.map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

function assembleState(
  rows: Record<string, EntryRow[]>,
  previousArchive: ArchiveEntry[] = [],
  action?: { module: string; id: number; action: string },
): StoreState {
  const normalized: Record<string, EntryRow[]> = {}
  for (const meta of MODULES) {
    normalized[meta.key] = (rows[meta.key] ?? []).map((row) => normalizeRow(meta.key, row))
  }
  const archive = reconcileArchive(normalized, previousArchive, action)
  return { rows: normalized, archive, overview: computeOverview(normalized), version: STORE_VERSION }
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage
}

function readLegacyRows(): Record<string, EntryRow[]> | null {
  if (!hasStorage()) {
    return null
  }
  const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as Record<string, EntryRow[]>
  } catch {
    return null
  }
}

function loadState(): StoreState {
  const fallback = assembleState(seedState())
  if (!hasStorage()) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as StoreState
      if (parsed && typeof parsed === 'object' && parsed.rows) {
        // 任何历史脏数据都在这里统一回填，保证后续取数不用再判空。
        return assembleState(parsed.rows, parsed.archive ?? [])
      }
    } catch {
      // 落回迁移/种子逻辑
    }
  }
  // 旧版本（只存行数据）迁移：按新口径回填 pending/abnormal 并重建归档清单。
  const legacy = readLegacyRows()
  const state = legacy
    ? assembleState({ ...seedState(), ...legacy })
    : fallback
  persistState(state)
  if (legacy) {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
  }
  return state
}

function persistState(state: StoreState): void {
  if (!hasStorage()) {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

let cache: StoreState | null = null
const listeners = new Set<ChangeListener>()

export function getState(): StoreState {
  if (cache === null) {
    cache = loadState()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return getState().rows[key] ?? []
}

// 事务提交：先在内存里组装出完整结果（行 + 归档 + 总览）并做一致性校验，
// 全部通过才一次性落盘；任一步失败都保留提交前快照，三处一起回退。
export function commitRows(
  key: string,
  rows: EntryRow[],
  action?: { id: number; action: string },
): StoreState {
  const before = getState()
  const snapshot = clone(before)
  let candidate: StoreState
  try {
    const merged = { ...before.rows, [key]: rows }
    candidate = assembleState(
      merged,
      before.archive,
      action ? { module: key, id: action.id, action: action.action } : undefined,
    )
    assertConsistent(candidate)
  } catch (error) {
    cache = snapshot
    throw error instanceof Error ? error : new Error('汇总失败，已回退本次操作')
  }
  try {
    persistState(candidate)
  } catch (error) {
    cache = snapshot
    throw error instanceof Error ? error : new Error('结果持久化失败，已回退本次操作')
  }
  cache = candidate
  listeners.forEach((listener) => listener())
  return candidate
}

// 一致性不变量：
// 1) 总览数字必须能从行数据重新算出来；
// 2) 归档清单必须与「办结行集合」一一对应且无重复（同一记录只计一次）。
export function assertConsistent(state: StoreState): void {
  const recomputed = computeOverview(state.rows)
  const overviewJson = JSON.stringify(state.overview)
  if (overviewJson !== JSON.stringify(recomputed)) {
    throw new Error('总览汇总与明细不一致，已回退本次操作')
  }
  const keys = new Set<string>()
  for (const entry of state.archive) {
    const mapKey = `${entry.module}:${entry.id}`
    if (keys.has(mapKey)) {
      throw new Error(`归档清单存在重复记录：${mapKey}，已回退本次操作`)
    }
    keys.add(mapKey)
    const row = (state.rows[entry.module] ?? []).find((item) => Number(item.id) === entry.id)
    if (!row) {
      throw new Error(`归档清单指向不存在的记录：${mapKey}，已回退本次操作`)
    }
    const meta = MODULE_BY_KEY.get(entry.module)
    if (!isClosedStatus(meta, String(row.status))) {
      throw new Error(`归档清单残留非办结记录：${mapKey}，已回退本次操作`)
    }
  }
  for (const meta of MODULES) {
    for (const row of state.rows[meta.key] ?? []) {
      const mapKey = `${meta.key}:${row.id}`
      const closed = isClosedStatus(meta, String(row.status))
      const archived = keys.has(mapKey)
      if (closed !== archived) {
        throw new Error(`归档清单与列表状态不一致：${mapKey}，已回退本次操作`)
      }
      if (row.pending !== !closed || row.abnormal !== isAbnormalStatus(meta, String(row.status))) {
        throw new Error(`记录标记与状态不一致：${mapKey}，已回退本次操作`)
      }
    }
  }
}

export function resetRows(key: string): EntryRow[] {
  const seeded = seedState()[key] ?? []
  commitRows(key, clone(seeded))
  return listRows(key)
}

export function subscribe(listener: ChangeListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function storageKey(): string {
  return STORAGE_KEY
}
