import { MODULE_BY_KEY } from '@/data/modules'
import { commitRows, getState, listRows, resetRows, subscribe } from '@/data/local-store'
import type {
  ActionResult,
  ArchivePageResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // pending / abnormal 不再由动作名推断，只写状态，标记在事务提交时按统一口径从状态派生。
  // 同一记录连续动作：若状态没有变化，这里直接短路（幂等，只计一次）。
  const updated: EntryRow = { ...rows[index], status: target }
  const next = [...rows]
  next[index] = updated
  try {
    // 行、归档清单、总览快照在同一个事务里提交：任一汇总/对账失败三处一起回退。
    commitRows(key, next, { id, action })
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : `${meta.entity}处置失败，已回退`,
    }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function listArchive(moduleKey: string = ''): ArchivePageResult {
  const items = getState().archive.filter(
    (entry) => moduleKey === '' || entry.module === moduleKey,
  )
  return { items, total: items.length }
}

// 总览与列表、归档读的是同一事务提交后的状态快照，保证三处数字对得上。
export function loadOverview(): OverviewResult {
  return getState().overview
}

export function onStoreChange(listener: () => void): () => void {
  return subscribe(listener)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
