// 端到端验证：用内存版 localStorage 跑通「页面动作 → 事务持久化 → 总览/列表/归档取数」整条链。
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const harness = `
import { runAction, listEntries, listArchive, loadOverview, resetModule } from '@/api/local-service'
import { getState, commitRows } from '@/data/local-store'
import { MODULES } from '@/data/modules'

const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail: String(detail) })
}
const card = (label) => loadOverview().cards.find((c) => c.label === label).value
const moduleRow = (name) => loadOverview().modules.find((m) => m.name === name)

// 0. 旧数据迁移（预置旧信封）：待审核误标 abnormal=true；发现故障旧标记 abnormal=false；
//    通讯中断旧标记 pending=false；且有一条完全缺 pending/abnormal 的旧记录。
const insp3 = listEntries('inspection').items.find((r) => r.id === 3)
check('历史异常态回填 abnormal=true（发现故障）', insp3.abnormal === true && insp3.pending === true, JSON.stringify({ a: insp3.abnormal, p: insp3.pending }))
const wl2 = listEntries('waterlevel').items.find((r) => r.id === 2)
check('历史误标异常被纠正（待审核 abnormal=false）', wl2.abnormal === false, JSON.stringify({ a: wl2.abnormal, p: wl2.pending }))
const comm3 = listEntries('communication').items.find((r) => r.id === 3)
check('历史异常中间态回到待处理（通讯中断 pending=true）', comm3.pending === true && comm3.abnormal === true, JSON.stringify({ a: comm3.abnormal, p: comm3.pending }))
const tel3 = listEntries('telemetry').items.find((r) => r.id === 3)
check('缺失标记的旧记录按状态回填（低电量 abnormal=true pending=true）', tel3.abnormal === true && tel3.pending === true, JSON.stringify({ a: tel3.abnormal, p: tel3.pending }))
check('旧信封键已迁移删除', globalThis.__localStorage.getItem('hydrology-monitor-station:entries') === null)

// 1. 完成处置后汇总数字变化：发现故障 → 确认处置
const abn0 = card('异常量'), pen0 = card('待处理')
const r1 = runAction('inspection', 3, '确认处置')
check('确认处置成功', r1.ok, r1.message)
check('完成处置后异常量-1', card('异常量') === abn0 - 1, \`\${abn0}->\${card('异常量')}\`)
check('完成处置后待处理-1', card('待处理') === pen0 - 1, \`\${pen0}->\${card('待处理')}\`)
const i3 = listEntries('inspection').items.find((r) => r.id === 3)
check('列表记录同步为已处置/非待处理/非异常', i3.status === '已处置' && !i3.pending && !i3.abnormal)
check('归档出现该记录且仅一条', listArchive('inspection').items.filter((a) => a.id === 3).length === 1)
check('归档条目记住处置动作', listArchive('inspection').items.find((a) => a.id === 3)?.action === '确认处置')

// 2. 同一记录连续动作只计一次
const dup1 = runAction('inspection', 3, '确认处置')
check('同状态重复动作被幂等拦截', !dup1.ok, dup1.message)
check('重复动作不产生归档重复', listArchive('inspection').items.filter((a) => a.id === 3).length === 1)
runAction('inspection', 2, '报告故障') // 已巡检 → 发现故障（在办，不归档）
runAction('inspection', 2, '完成巡检') // 回到已巡检
check('在办状态来回不留归档', listArchive('inspection').items.find((a) => a.id === 2) === undefined)
runAction('inspection', 2, '报告故障')
runAction('inspection', 2, '确认处置') // → 已处置
check('经多次流转后归档仍只一条', listArchive('inspection').items.filter((a) => a.id === 2).length === 1)

// 2b. 已归档记录的归档时间不被其它动作提交刷新（原地保留首次办结时间）
const arc3time = listArchive('inspection').items.find((a) => a.id === 3).archivedAt
await new Promise((resolve) => setTimeout(resolve, 10))
runAction('station', 2, '登记故障') // 触发一次与归档无关的提交
check('既有归档条目的时间不被后续提交刷新', listArchive('inspection').items.find((a) => a.id === 3).archivedAt === arc3time)

// 3. 反向动作（撤销/驳回/停用）：无待处理残留、进归档且标异常
const abn1 = card('异常量')
const rs = runAction('station', 1, '撤销站点')
check('撤销站点成功', rs.ok, rs.message)
const s1 = listEntries('station').items.find((r) => r.id === 1)
check('撤销后无待处理残留且标异常', s1.pending === false && s1.abnormal === true)
check('撤销后异常量+1', card('异常量') === abn1 + 1)
const aS1 = listArchive('station').items.filter((a) => a.id === 1)
check('撤销记录归档仅一条且标异常', aS1.length === 1 && aS1[0].abnormal === true && aS1[0].status === '已撤销')

const rc = runAction('compilation', 3, '驳回整编')
check('驳回整编成功（旧动作名前缀逻辑识别不到“驳回整编”？可识别）', rc.ok, rc.message)
const c3 = listEntries('compilation').items.find((r) => r.id === 3)
check('驳回后无待处理残留且标异常', c3.pending === false && c3.abnormal === true)
check('驳回记录进入归档', listArchive('compilation').items.some((a) => a.id === 3 && a.abnormal))

const rt = runAction('telemetry', 1, '停用设备')
check('停用设备成功', rt.ok, rt.message)
const t1 = listEntries('telemetry').items.find((r) => r.id === 1)
check('停用后无待处理残留', t1.pending === false && t1.abnormal === true)

// 4. 标记异常（旧逻辑根本不置 abnormal）+ 处置清零
runAction('waterlevel', 2, '标记异常')
check('标记异常后模块异常计数=1', moduleRow('水位监测').abnormal === 1, String(moduleRow('水位监测').abnormal))
runAction('waterlevel', 2, '确认通过')
check('确认通过后模块异常清零', moduleRow('水位监测').abnormal === 0, String(moduleRow('水位监测').abnormal))
check('通过记录进归档为正常', listArchive('waterlevel').items.some((a) => a.id === 2 && !a.abnormal && a.status === '已通过'))

// 5. 旧 pending 残留场景：仪器检定 标记不合格
const ru = runAction('calibration', 1, '标记不合格')
check('标记不合格成功', ru.ok, ru.message)
const cal1 = listEntries('calibration').items.find((r) => r.id === 1)
check('不合格不残留待处理且标异常', cal1.pending === false && cal1.abnormal === true, JSON.stringify({ p: cal1.pending, a: cal1.abnormal }))
check('不合格进入归档', listArchive('calibration').items.some((a) => a.id === 1))

// 6. 总览 == 列表 == 归档，三处同源
const ov = loadOverview()
let consistent = true
const bad = []
for (const meta of MODULES) {
  const rows = getState().rows[meta.key]
  const ovm = ov.modules.find((m) => m.name === meta.name)
  const listPending = rows.filter((r) => r.pending).length
  const listAbnormal = rows.filter((r) => r.abnormal).length
  const closedCount = rows.filter((r) => !r.pending).length
  const arcCount = getState().archive.filter((a) => a.module === meta.key).length
  if (ovm.pending !== listPending || ovm.abnormal !== listAbnormal || arcCount !== closedCount) {
    consistent = false
    bad.push(\`\${meta.key}: ov=\${ovm.pending}/\${ovm.abnormal} list=\${listPending}/\${listAbnormal} arc=\${arcCount}/closed=\${closedCount}\`)
  }
}
check('总览/列表/归档三处数字一致', consistent, bad.join(' | '))

// 7. 归档全局唯一，且每条都能在列表中找到对应办结行（无旧记录残留）
const seen = new Set()
let unique = true
let dangling = false
for (const a of getState().archive) {
  const k = \`\${a.module}:\${a.id}\`
  if (seen.has(k)) unique = false
  seen.add(k)
  const row = (getState().rows[a.module] ?? []).find((r) => Number(r.id) === a.id)
  if (!row || row.pending || row.status !== a.status) dangling = true
}
check('归档无重复键', unique)
check('归档无悬挂/过期旧记录', !dangling)

// 8. 事务回退：让持久化抛错，断言行/归档/总览全部保持旧值
const before = JSON.stringify(getState())
globalThis.__storageShouldThrow = true
let caught = false
try {
  runAction('station', 2, '撤销站点')
} catch (e) {
  caught = true
}
globalThis.__storageShouldThrow = false
// runAction 内部 catch 并返回 ok:false
const rr = (() => {
  globalThis.__storageShouldThrow = true
  const out = runAction('station', 2, '撤销站点')
  globalThis.__storageShouldThrow = false
  return out
})()
check('持久化失败时动作返回失败', rr.ok === false, rr.message)
check('失败后三处一起回退（状态完全不变）', JSON.stringify(getState()) === before)
const s2 = listEntries('station').items.find((r) => r.id === 2)
check('回退后列表记录仍是设备故障', s2.status === '设备故障' && s2.pending === true && s2.abnormal === true)
check('回退后归档未新增', listArchive('station').items.some((a) => a.id === 2) === false)

// 9. 重置模块：行、归档、总览一起回到种子口径
resetModule('inspection')
const ri = moduleRow('巡检记录')
check('重置后列表 3 条', listEntries('inspection').items.length === 3)
check('重置后归档剔除该模块记录', listArchive('inspection').items.length === 0)
check('重置后总览与列表一致', ri.pending === listEntries('inspection').items.filter((r) => r.pending).length)

console.log('RESULT_JSON:' + JSON.stringify(results))
`

const prelude = `
// 内存版 localStorage；预置一份旧版本数据（缺字段、标记错乱）用于验证迁移与回填。
const mem = new Map()
mem.set('hydrology-monitor-station:entries', JSON.stringify({
  inspection: [
    { id: 1, status: '待巡检', pending: true, abnormal: false, 记录编号: 'INSP-0001' },
    { id: 2, status: '已巡检', pending: true, abnormal: false, 记录编号: 'INSP-0002' },
    { id: 3, status: '发现故障', pending: true, abnormal: false, 记录编号: 'INSP-0003' },
  ],
  waterlevel: [
    { id: 1, status: '已采集', pending: true, abnormal: false, 记录编号: 'WATE-0001' },
    { id: 2, status: '待审核', pending: true, abnormal: true, 记录编号: 'WATE-0002' },
    { id: 3, status: '已通过', pending: false, abnormal: false, 记录编号: 'WATE-0003' },
  ],
  communication: [
    { id: 1, status: '通讯正常', pending: true, abnormal: false, 设备编号: 'COMM-0001' },
    { id: 2, status: '信号弱', pending: true, abnormal: true, 设备编号: 'COMM-0002' },
    { id: 3, status: '通讯中断', pending: false, abnormal: false, 设备编号: 'COMM-0003' },
  ],
  telemetry: [
    { id: 1, status: '正常运行', 设备编号: 'TELE-0001' },
    { id: 2, status: '信号异常', pending: true, abnormal: true, 设备编号: 'TELE-0002' },
    { id: 3, status: '低电量', 设备编号: 'TELE-0003' },
  ],
}))
globalThis.__localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { if (globalThis.__storageShouldThrow) throw new Error('mock quota exceeded'); mem.set(k, String(v)) },
  removeItem: (k) => { mem.delete(k) },
}
globalThis.window = { localStorage: globalThis.__localStorage }
`

const dir = mkdtempSync(join(tmpdir(), 'hydro-test-'))
writeFileSync(join(dir, 'harness.ts'), prelude + '\n' + harness)

await build({
  entryPoints: [join(dir, 'harness.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: join(dir, 'out.mjs'),
  alias: { '@': '/workspace/frontend/src' },
})

const { stdout, stderr } = await import('node:child_process').then((cp) =>
  new Promise((resolve, reject) =>
    cp.execFile(process.execPath, [join(dir, 'out.mjs')], (err, out, serr) =>
      err ? reject(new Error(out + '\n' + serr)) : resolve({ stdout: out, stderr: serr }),
    ),
  ),
)
if (stderr) console.error(stderr)
const line = stdout.split('\n').find((l) => l.startsWith('RESULT_JSON:'))
const results = JSON.parse(line.slice('RESULT_JSON:'.length))
let failed = 0
for (const r of results) {
  if (!r.ok) failed++
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}` + (r.ok ? '' : `\n      ↳ ${r.detail}`))
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
