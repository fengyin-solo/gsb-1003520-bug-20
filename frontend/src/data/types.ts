/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type MetricRule = {
  label: string
  // 命中的状态集合；空数组代表该模块全部记录（总量口径）。
  statuses: string[]
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
  // 终态集合：落在这些状态上的记录不再算「待处理」，会进入归档清单。
  closedStatuses: string[]
  // 异常状态集合：只有落在这些状态上才算「异常」，处置完成即移出。
  abnormalStatuses: string[]
  // 与 metrics 一一对应的取数口径，保证模块页卡片和总览同源。
  metricRules: MetricRule[]
}

export type ArchiveRow = {
  module: string
  moduleName: string
  id: number
  code: string
  status: string
  abnormal: boolean
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
