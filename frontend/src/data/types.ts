/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  // 已办结（归档）状态：进入即离开待处理队列，进入归档清单；离开则回到在办。
  closedStatuses: string[]
  // 异常状态：当前处于故障/异常/反向终态等需要关注的状态，处置完成后必须能清零。
  abnormalStatuses: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 归档清单中的一条：同一业务记录（模块 + id）在清单里永远只有一条，随最新结果原地更新。
export type ArchiveEntry = {
  module: string
  id: number
  status: string
  abnormal: boolean
  action: string
  archivedAt: string
  row: EntryRow
}

export type ArchivePageResult = {
  items: ArchiveEntry[]
  total: number
}
