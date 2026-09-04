import 'dotenv/config'
import express from 'express'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

const app = express()
const __dirname = dirname(fileURLToPath(import.meta.url))
const mockData = JSON.parse(readFileSync(join(__dirname, 'mock-data.json'), 'utf8'))
const port = Number(process.env.PORT || 8787)
const staticDir = join(__dirname, '..', 'dist')

app.use(express.json({ limit: '22mb' }))

// ---------------------------------------------------------------------------
// 数据资产三库分列（PRD V2 §13）
// ---------------------------------------------------------------------------
const masterDrugs = mockData.drugs // 药品身份库：识药匹配对象，不含个人信息
const packageInserts = mockData.packageInserts // 说明书库：按键取数（drugId 直查）
const interactionRules = mockData.interactionRules // 相互作用规则库：内容只抄录，禁止模型生成
const mockDrugCatalog = mockData.drugs // 患者洞察目录

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------
const emergencyPattern = /胸痛|呼吸困难|意识异常|昏迷|抽搐|大量误服|儿童误服|严重过敏|喉头紧缩|呕血|黑便|大量出血|自杀|自伤/
// L3 拒答：覆盖停药/换药/剂量调整的常见口语变体（如「把这个药停了」「能不能停」）
const prohibitedPattern = /停药|停用|把这个?药?停|药停了|停掉|停吗|停不停|能停|可以停|要不要停|换药|换成|换掉|能换|可以换|增量|减量|加量|改剂量|改成.*片|应该吃几片|能吃几片|多吃了一|吃多了一/
// L2 过滤：具体剂量/频次数字（含「每日使用超过10次」这类间隔写法）
const dosageOutputPattern =
  /一日\s*[\d.]+|每天\s*[\d.]+|每日\s*[\d.]+|每次\s*[\d.]+|分\s*\d+\s*次|每[日天][^，。;；]{0,8}\d+\s*次|[\d.]+\s*(?:mg|g|毫克|克|片|粒|滴).{0,8}(?:一日|每天|每次|每日|服用)|建议.{0,6}(?:服用|用量|剂量)/i

function cleanBaseUrl(value, fallback) {
  return (value || fallback).replace(/\/+$/, '')
}

function sanitizeText(text) {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\^\[\d+\]\^/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/#{1,6}\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function containsDosageAdvice(text) {
  return dosageOutputPattern.test(String(text || ''))
}

function stripDosageAdvice(text) {
  if (!containsDosageAdvice(text)) return sanitizeText(text)
  return sanitizeText(text).replace(/[^。！？]*?(?:一日|每天|每次|分\s*\d+\s*次|mg|g|片|粒)[^。！？]*[。！？]?/gi, '')
}

function safeJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) return extractPartialJson(cleaned)
    try {
      return JSON.parse(match[0])
    } catch {
      return extractPartialJson(cleaned)
    }
  }
}

function extractPartialJson(text) {
  const pick = (key) => {
    const match = text.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`))
    return match ? sanitizeText(match[1]) : ''
  }
  const pickArray = (key) => {
    const match = text.match(new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]*)\\]`))
    if (!match) return []
    return [...match[1].matchAll(/"([^"]*)"/g)].map((item) => sanitizeText(item[1])).filter(Boolean)
  }
  const summary = pick('summary')
  if (!summary) return null
  return {
    summary,
    keyPoints: pickArray('keyPoints'),
    risks: pickArray('risks'),
    nextAction: pick('nextAction'),
    warning: pick('warning'),
  }
}

async function chatCompletion({ baseUrl, apiKey, model, messages, temperature = 0.1 }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, temperature }),
    signal: AbortSignal.timeout(60_000),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const providerMessage = payload?.error?.message || payload?.message || `上游服务返回 ${response.status}`
    throw new Error(providerMessage)
  }
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型未返回有效内容')
  return content
}

function normalize(value) {
  return String(value || '').replace(/\s|×|x|X|\*/gi, '').toLowerCase()
}

// ---------------------------------------------------------------------------
// 拍照录入 · 医嘱线（PRD V2 §7.2.2 / §12.2）
// OCR 全文仅在内存中即用即弃；以下解析只输出白名单 schema，身份信息结构上无法进入。
// ---------------------------------------------------------------------------

// L2 黑名单兜底：对白名单值跑模式匹配，命中替换为 [已脱敏] 并记审计（只记类型与次数）
const SENSITIVE_PATTERNS = [
  { type: '手机号', re: /1[3-9]\d{9}/g },
  { type: '身份证号', re: /\d{17}[\dXx]/g },
  { type: '地址', re: /[\u4e00-\u9fa5]{2,8}(?:省|市)[\u4e00-\u9fa5]{2,10}(?:区|县|镇|街道)[\u4e00-\u9fa5]{2,12}(?:路|街|道|巷)\s*\d*号?/g },
]

function scrubValue(value, audit) {
  let out = String(value || '')
  for (const pattern of SENSITIVE_PATTERNS) {
    const hits = out.match(pattern.re)
    if (hits) {
      audit[pattern.type] = (audit[pattern.type] || 0) + hits.length
      out = out.replace(new RegExp(pattern.re.source, pattern.re.flags), '[已脱敏]')
    }
  }
  return out
}

// 医嘱用法用量解析：正则模板为主（"每次X / 每日X次 / 共X天"），规则抽不出走原文人工补
function parseSig(text) {
  const sig = {}
  const dose = String(text || '').match(/(?:每次|一次)\s*([\d.]+)\s*(滴|片|粒|支|袋|喷|丸|mg|毫克|g|克)/)
  if (dose) sig.dose = { value: Number(dose[1]), unit: dose[2].replace('毫克', 'mg').replace('克', 'g') }
  const freq = String(text || '').match(/(?:每日|一日|每天)\s*(\d+)\s*次/)
  if (freq) sig.frequency = Number(freq[1])
  const dur = String(text || '').match(/(?:共|疗程)\s*(\d+)\s*天/)
  if (dur) sig.durationDays = Number(dur[1])
  const route = String(text || '').match(/(口服|滴眼|滴入|外用|静脉滴注|静脉注射|肌内注射|皮下注射|雾化吸入|舌下含服|含服|直肠给药|局部涂抹|睡前服)/)
  if (route) sig.route = route[1]
  return sig
}

function parseDrugLine(line) {
  const tokens = line.split(/\s+/)
  const name = tokens.find((token) => /^[\u4e00-\u9fa5]/.test(token) && /滴眼液|滴眼|注射液|口服液|片|胶囊|颗粒|丸|栓|膏|贴|喷|吸入|混悬/.test(token))
  const spec = tokens.find((token) => /\d/.test(token) && /%|mg|g|ml|μg|iu/i.test(token))
  if (!name || !spec) return null
  const qty = line.match(/[×xX]\s*(\d+)\s*([\u4e00-\u9fa5]{1,2})?/)
  return {
    name,
    spec,
    quantity: qty ? `${qty[1]}${qty[2] || ''}` : '',
    raw: line,
  }
}

// L1 白名单解析：输出闭合 schema {医院, 处方号, 日期, 科室, 诊断, 条目[]}，schema 之外没有字段
function parsePrescriptionText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const result = { hospital: '', rxNo: '', date: '', department: '', diagnosis: '', items: [], patientHint: {}, anchors: {} }

  for (const line of lines) {
    if (!result.hospital) {
      const m = line.match(/([\u4e00-\u9fa5]{2,12}(?:医院|卫生院|门诊部|诊所))/)
      if (m) result.hospital = m[1]
    }
    if (!result.rxNo) {
      const m = line.match(/(?:处方号|处方编号|No\.?)[：:]\s*([A-Za-z0-9-]{4,20})/)
      if (m) result.rxNo = m[1]
    }
    if (!result.date) {
      const m = line.match(/(\d{4})[年/\-.](\d{1,2})[月/\-.](\d{1,2})/)
      if (m) result.date = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
    }
    if (!result.department) {
      const m = line.match(/(?:科室|科别)[：:]\s*([\u4e00-\u9fa5]{1,8})/)
      if (m) result.department = m[1]
    }
    if (!result.diagnosis) {
      const m = line.match(/(?:临床诊断|诊断)[：:]\s*(.+)/)
      if (m) result.diagnosis = m[1].trim()
    }
    if (!result.patientHint.gender) {
      const m = line.match(/性别[：:]?\s*(男|女)/)
      if (m) result.patientHint.gender = m[1]
    }
    if (result.patientHint.age == null) {
      const m = line.match(/年龄[：:]?\s*(\d{1,3})\s*岁?/)
      if (m) result.patientHint.age = Number(m[1])
    }
  }

  // L0 版面裁剪的文本等价：Rp 至「处方完毕/医师签名」之间为正文，前记后记整块不进入条目解析
  const rpIdx = lines.findIndex((line) => /^(rp|℞)$/i.test(line.replace(/[\s:：]/g, '')))
  result.anchors.rpFound = rpIdx >= 0
  let body = lines
  if (rpIdx >= 0) {
    const endIdx = lines.findIndex((line, idx) => idx > rpIdx && /处方完毕|医[师生]\s*[：:]|审核|调配/.test(line))
    body = lines.slice(rpIdx + 1, endIdx > rpIdx ? endIdx : lines.length)
  }

  for (const line of body) {
    const sig = parseSig(line)
    const isSigLine = /^(用法|Sig|sig)/.test(line) || (sig.dose && sig.frequency)
    if (isSigLine && result.items.length > 0) {
      const item = result.items[result.items.length - 1]
      item.sig = { ...item.sig, ...sig }
      item.sigText = line
      continue
    }
    const drug = parseDrugLine(line)
    if (drug) result.items.push({ ...drug, sig: {}, sigText: '' })
  }
  return result
}

// 医院标签层：标签上的用法用量被抄录进计划草稿（疗程标签上没有 → 三选一）
function parseLabelText(text) {
  const raw = String(text || '')
  const sig = parseSig(raw)
  // 包装滴数声明（「约200滴」「约300滴/支」）——必须排除医嘱行里的「每次1滴」
  const dropDecls = [...raw.matchAll(/约?\s*(\d{2,4})\s*滴\s*\/?\s*支?/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 20)
  const drops = [...new Set(dropDecls)]
  const date = raw.match(/(\d{4})[年/\-.](\d{1,2})[月/\-.](\d{1,2})/)
  return {
    sig,
    dropCounts: drops,
    date: date ? `${date[1]}-${String(date[2]).padStart(2, '0')}-${String(date[3]).padStart(2, '0')}` : '',
    sigText: (raw.split(/\r?\n/).find((line) => /用法/.test(line)) || '').trim(),
  }
}

// ---------------------------------------------------------------------------
// 拍照录入 · 身份线（PRD V2 §7.2.3 / §8.2）
// 药名 + 规格 + 剂型三项严格核对；任何冲突、多候选、规格不一致进入冲突清单，不自动裁决。
// 药盒层不提取用法用量：盒面用法是说明书通用剂量而非医嘱。
// ---------------------------------------------------------------------------

// 规格强度解析：优先 % 浓度，其次质量（统一换算为 mg）；体积 mL 不作为 potency
function parseStrengthTokens(spec) {
  const s = normalize(spec)
  const tokens = { pct: [], mg: [] }
  const pct = s.match(/([\d.]+)%/)
  if (pct) tokens.pct.push(Number(pct[1]))
  for (const m of s.matchAll(/([\d.]+)\s*(mg|毫克|g|克|μg)/gi)) {
    const value = Number(m[1])
    const unit = m[2].toLowerCase()
    tokens.mg.push(unit === 'g' || unit === '克' ? value * 1000 : unit === 'μg' ? value / 1000 : value)
  }
  return tokens
}

function tokensOverlap(a, b) {
  const pctOverlap = a.pct.length > 0 && b.pct.length > 0 && a.pct.some((v) => b.pct.includes(v))
  const mgOverlap = a.mg.length > 0 && b.mg.length > 0 && a.mg.some((v) => b.mg.some((w) => Math.abs(v - w) < 0.001))
  if (a.pct.length > 0 && b.pct.length > 0) return pctOverlap
  return pctOverlap || mgOverlap
}

function nameMatches(a, b) {
  const na = normalize(a)
  const nb = normalize(b)
  return (na && nb && (na.includes(nb) || nb.includes(na))) || false
}

function formMatches(identityForm, drugForm) {
  if (!identityForm) return true
  const a = normalize(identityForm)
  const b = normalize(drugForm)
  return b.includes(a) || a.includes(b)
}

// 批准文号 = 平局裁判（PRD §8.2）：多候选时用于一锤定音；处方笺/贴标药盒上没有该字段时不作为通过条件
function matchItem({ itemName, itemSpec, identity }) {
  const name = identity?.genericName || itemName || ''
  const pool = masterDrugs.filter((d) => nameMatches(name, d.genericName) && formMatches(identity?.form, d.form))
  const identityTokens = parseStrengthTokens(identity?.specification || itemSpec || '')
  const itemTokens = parseStrengthTokens(itemSpec || '')
  const specOk = (d) => tokensOverlap(parseStrengthTokens(d.specification), identityTokens) || tokensOverlap(parseStrengthTokens(d.specification), itemTokens)
  const matches = pool.filter(specOk)
  const conflicts = []
  let match = matches.length === 1 ? matches[0] : null
  let resolutionNote = ''

  // 线间冲突：处方/标签原文规格 与 身份线识别规格不一致（多规格风险高发点）
  const crossDisagree = itemSpec && identity?.specification && !tokensOverlap(itemTokens, identityTokens)
  if (crossDisagree) {
    conflicts.push({
      type: 'spec',
      note: `处方/标签规格 ${itemSpec} 与识别规格 ${identity.specification} 不一致，且该药名存在多规格条目，请核对药品实物后选择：`,
      candidates: pool.length ? pool : masterDrugs.filter((d) => nameMatches(name, d.genericName)),
    })
  } else if (matches.length > 1) {
    // 多候选：尝试批准文号平局裁决
    const byApproval = identity?.approval ? matches.filter((d) => normalize(d.approval) === normalize(identity.approval)) : []
    if (byApproval.length === 1) {
      match = byApproval[0]
      resolutionNote = `多候选已按批准文号 ${identity.approval} 裁决为唯一匹配（置信度：实物/官方库 > 多源交叉）`
    } else {
      conflicts.push({ type: 'multi', note: '药品主数据库中存在多个候选，请逐项核对后选择：', candidates: matches })
    }
  } else if (matches.length === 0 && pool.length > 0) {
    conflicts.push({
      type: 'spec',
      note: `识别规格与主数据库条目不一致（识别：${identity?.specification || itemSpec || '未知'}），请核对规格或选择手动建档：`,
      candidates: pool,
    })
  }

  return {
    match,
    matchStatus: match ? 'unique' : pool.length ? 'conflict' : 'unmatched',
    conflicts,
    resolutionNote,
  }
}

// ---------------------------------------------------------------------------
// 草稿汇合（PRD V2 §7.2.5 / §9.1 ⑤）
// ---------------------------------------------------------------------------

// 服药时间点建议：按频次在 8:00–22:00 均匀分布（每日 4 次 → 8/12/16/20），标注「辅助，可调整」
function suggestTimes(frequency) {
  const n = Math.max(1, Math.min(8, Number(frequency) || 1))
  if (n === 1) return ['08:00']
  return Array.from({ length: n }, (_, i) => `${String(8 + Math.round((12 * i) / (n - 1))).padStart(2, '0')}:00`)
}

function addDays(dateStr, days) {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + Number(days))
  return d.toISOString().slice(0, 10)
}

// 说明书范围校验（规则引擎，对照说明书库的最大频次/单次用量上限）
function rangeCheck(draft, insert) {
  const adult = insert?.dosage?.adult
  if (!adult) return { status: 'none', issues: [], note: '说明书库未收录该药品的结构化用法用量，跳过范围校验' }
  const issues = []
  const max = adult.maxFrequencyPerDay
  if (max && draft.frequency && draft.frequency > max.value) {
    issues.push(`频次 ${draft.frequency} 次/日超过说明书上限 ${max.value} ${max.unit}/日（${max.note}）`)
  }
  const usual = adult.dosePerUse
  if (usual && draft.dose && draft.dose.unit === usual.unit && draft.dose.value > usual.value) {
    issues.push(`单次用量 ${draft.dose.value} ${usual.unit} 超过说明书常规 ${usual.value} ${usual.unit}，请核对医嘱原文`)
  }
  return {
    status: issues.length ? 'exceed' : 'pass',
    issues,
    basis: `${insert.source} · ${insert.version}`,
  }
}

// 相互作用检查：检查对象是「生效计划的集合」，不是药箱库存（PRD V2 §7.8.2）
function checkInteractionHits(newDrugId, activeDrugIds) {
  const active = [...new Set([...(activeDrugIds || [])])]
  const hits = interactionRules.filter(
    (rule) => rule.drugs.includes(newDrugId) && rule.drugs.every((id) => id === newDrugId || active.includes(id)),
  )
  return {
    has: hits.length > 0,
    items: hits.map((h) => ({ level: h.level, note: h.note, source: h.source, drugs: h.drugs })),
  }
}

// 四类标注：抄录 transcribed / 辅助 assist / 推算 derived / 默认 default
function buildPlanDraft({ sig, baseDate, hasLabelSource }) {
  const frequency = sig?.frequency || null
  const dose = sig?.dose || null
  const durationDays = sig?.durationDays || null
  const startDate = baseDate || new Date().toISOString().slice(0, 10)
  const draft = {
    dose,
    frequency,
    route: sig?.route || null,
    durationDays,
    sigMissing: ['dose', 'frequency'].filter((key) => !sig?.[key]),
    times: frequency ? suggestTimes(frequency) : [],
    startDate,
    endDate: durationDays ? addDays(startDate, durationDays) : null,
    cycleType: durationDays ? 'closed' : 'pending',
    tags: {
      dose: dose ? 'transcribed' : null,
      frequency: frequency ? 'transcribed' : null,
      route: sig?.route ? 'transcribed' : null,
      duration: durationDays ? 'transcribed' : null,
      times: 'assist',
      startDate: 'default',
      endDate: durationDays ? 'derived' : null,
    },
    sourceKind: hasLabelSource ? 'label' : 'prescription',
  }
  return draft
}

// ---------------------------------------------------------------------------
// 演示样例（合成化 golden case，对应 PRD V2 待确认事项 #6 / §16.1 验收）
// 真实样例来源：萧山区第二人民医院处方笺与贴标药盒（2026-09-02，玻璃酸钠滴眼液 0.1%）
// ---------------------------------------------------------------------------
const DEMO_SAMPLES = {
  'rx-hycosan': {
    label: '处方笺 · 海露（golden case）',
    description: '主线：医嘱线抄录 1 滴×每日4次×7天，身份线唯一匹配，含脱敏演示',
    layers: ['处方层'],
    quality: { level: 'high' },
    ocrText: [
      '萧山区第二人民医院（演示合成处方笺）',
      '处方号：RX20260902001',
      '日期：2026-09-02  科室：眼科',
      '临床诊断：干眼综合征 联系电话13800001234',
      '性别：女  年龄：58岁',
      'Rp',
      '玻璃酸钠滴眼液 0.1%（10mL：10mg） ×1支',
      '用法：滴眼 每次1滴 每日4次 共7天',
      '处方完毕',
      '医师：（签名）  审核：（签名）  调剂：（签名）',
    ].join('\n'),
    identity: {
      genericName: '玻璃酸钠滴眼液',
      brandName: '海露（HYCOSAN）',
      specification: '0.1%（10mL：10mg）',
      form: '滴眼液',
      manufacturer: 'EUSAN GmbH',
      otcMark: 'OTC甲',
    },
  },
  'rx-levofloxacin': {
    label: '处方笺 · 左氧氟沙星滴眼液',
    description: '相互作用演示：与已生效的海露计划命中「需监测」；患者性别与资料不一致触发提示',
    layers: ['处方层'],
    quality: { level: 'high' },
    ocrText: [
      '演示市第一人民医院（演示合成处方笺）',
      '处方号：RX20260903002',
      '日期：2026-09-03  科室：眼科',
      '临床诊断：细菌性结膜炎',
      '性别：男  年龄：63岁',
      'Rp',
      '左氧氟沙星滴眼液 0.5%（5mL：24.4mg） ×1支',
      '用法：滴眼 每次1滴 每日3次 共5天',
      '处方完毕',
      '医师：（签名）  审核：（签名）',
    ].join('\n'),
    identity: {
      genericName: '左氧氟沙星滴眼液',
      brandName: '可乐必妥（演示数据）',
      specification: '0.5%（5mL：24.4mg）',
      form: '滴眼液',
      manufacturer: '参天制药（演示数据）',
    },
  },
  'rx-spec-conflict': {
    label: '处方笺 · 海露（多规格冲突演示）',
    description: '处方 0.1% vs 识别 0.2%：冲突清单暴露，系统不选边，由用户核对实物后选择',
    layers: ['处方层'],
    quality: { level: 'high' },
    ocrText: [
      '萧山区第二人民医院（演示合成处方笺）',
      '处方号：RX20260902003',
      '日期：2026-09-02  科室：眼科',
      '临床诊断：干眼综合征',
      '性别：女  年龄：58岁',
      'Rp',
      '玻璃酸钠滴眼液 0.1%（10mL：10mg） ×1支',
      '用法：滴眼 每次1滴 每日4次 共7天',
      '处方完毕',
      '医师：（签名）  审核：（签名）',
    ].join('\n'),
    identity: {
      genericName: '玻璃酸钠滴眼液',
      brandName: '海露（HYCOSAN）',
      specification: '0.2%（10mL：20mg）',
      form: '滴眼液',
      manufacturer: 'URSAPHARM GmbH',
    },
  },
  'box-labeled-hycosan': {
    label: '贴标药盒 · 海露',
    description: '入口B：标签抄录用法用量、疗程缺失三选一、层间滴数冲突（标签 200 vs 盒面约 300）',
    layers: ['医院标签层', '药盒原装层'],
    quality: { level: 'high' },
    ocrText: [
      '【医院药房标签】',
      '玻璃酸钠滴眼液 0.1%（10mL：10mg） ×1支 约200滴',
      '用法：滴眼 每次1滴 每日4次',
      '发药日期：2026-09-02',
      '【药盒原装面】',
      '海露 HYCOSAN 玻璃酸钠滴眼液 0.1%',
      '约300滴/支 不含防腐剂',
    ].join('\n'),
    identity: {
      genericName: '玻璃酸钠滴眼液',
      brandName: '海露（HYCOSAN）',
      specification: '0.1%（10mL：10mg）',
      form: '滴眼液',
      manufacturer: 'EUSAN GmbH',
      otcMark: 'OTC甲',
    },
  },
  'box-otc-hycosan': {
    label: '自购药盒 · 海露',
    description: '入口B 两步式：仅身份线建档，药盒层不提取用法用量，计划由用户手动创建',
    layers: ['药盒原装层'],
    quality: { level: 'high' },
    ocrText: null,
    identity: {
      genericName: '玻璃酸钠滴眼液',
      brandName: '海露（HYCOSAN）',
      specification: '0.1%（10mL：10mg）',
      form: '滴眼液',
      manufacturer: 'EUSAN GmbH',
      otcMark: 'OTC甲',
    },
  },
}

// 层检测作为入口校验而非分流：检测结果与所选入口不符时提示确认或切换，不静默改道
function entryWarning(entry, layers) {
  const has = (layer) => layers.includes(layer)
  if (has('不支持')) return null
  if (entry === 'A') {
    if (!has('处方层')) {
      if (has('医院标签层') || has('药盒原装层')) {
        return `检测到${layers.join('、')}，未检测到处方层。你选择的是「拍处方笺」，是否切换到「拍药品」入口？`
      }
      return '未在图片中检测到处方内容。你选择的是「拍处方笺」，请确认拍摄的是处方笺。'
    }
    return null
  }
  if (!has('医院标签层') && !has('药盒原装层')) {
    if (has('处方层')) return '检测到处方层。你选择的是「拍药品」，是否切换到「拍处方笺」入口？'
    return '未检测到可识别的药品包装或医院标签。'
  }
  return null
}

function formFromName(name) {
  const m = String(name || '').match(/(滴眼液|滴眼|注射液|口服液|喷雾剂|软膏|乳膏|滴丸|颗粒|胶囊|栓|贴)/)
  if (m) return m[1].replace('滴眼', '滴眼液')
  if (/片$/.test(name || '')) return '片剂'
  return ''
}

// ---------------------------------------------------------------------------
// /api/extract · 双线提取主入口
// 请求：{ entry: 'A'|'B', image?: dataURL, demoSample?: key, activeDrugIds?: string[] }
// 医嘱线：OCR → 版面裁剪 → 白名单解析 → 兜底扫描
// 身份线：VLM 提取身份 → 主数据库严格匹配
// 汇合：档案草稿 + 计划草稿 + 健康信息建议 + 相互作用检查 + 说明书范围校验
// ---------------------------------------------------------------------------
app.post('/api/extract', async (request, response) => {
  const { entry, image, demoSample, activeDrugIds } = request.body || {}
  if (entry !== 'A' && entry !== 'B') return response.status(400).json({ error: '请选择录入入口（拍处方笺 / 拍药品）' })

  let mode = 'vlm'
  let layers = []
  let quality = { level: 'high' }
  let ocrText = ''
  let identity = null

  try {
    if (demoSample) {
      const sample = DEMO_SAMPLES[demoSample]
      if (!sample) return response.status(400).json({ error: '未找到该演示样例' })
      mode = 'demo'
      layers = sample.layers
      quality = sample.quality
      ocrText = sample.ocrText || ''
      identity = sample.identity
    } else {
      if (typeof image !== 'string' || !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(image)) {
        return response.status(400).json({ error: '请上传 JPG、PNG 或 WebP 图片' })
      }
      if (image.length > 21 * 1024 * 1024) return response.status(413).json({ error: '图片过大，请压缩到 15MB 以内' })
      if (!process.env.QWEN_API_KEY) {
        return response.status(503).json({ error: '服务端未配置 QWEN_API_KEY，可先使用页面上的演示样例体验完整流程' })
      }

      // 身份线 VLM + 层检测（VLM 单次自评，待确认事项 #2）
      const identityContent = await chatCompletion({
        baseUrl: cleanBaseUrl(process.env.QWEN_BASE_URL, 'https://llm-fazbhtxxim0fqh5e.cn-beijing.maas.aliyuncs.com/api/v1'),
        apiKey: process.env.QWEN_API_KEY,
        model: process.env.QWEN_VL_MODEL || 'qwen3.5-ocr',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: image } },
              {
                type: 'text',
                text: '分析这张照片。只输出严格 JSON，不要 Markdown：{"layers":["从这些值中选：处方层|医院标签层|药盒原装层|说明书层|不支持，可多选"],"quality":"high|low","qualityReason":"质量问题一句话：反光/过暗/遮挡/模糊/无","identity":{"genericName":"","brandName":"","specification":"","form":"","manufacturer":"","otcMark":""}}。层判定：印刷的处方笺（含 Rp、处方号、临床诊断）为处方层；贴在药盒上的医院药房标签为医院标签层；药盒原装印刷面为药盒原装层；纸质说明书为说明书层；散装药片、无法辨认的对象为不支持。identity 只填照片中可见的药品身份信息，不确定的字段留空，不要根据外观猜测药名。',
              },
            ],
          },
        ],
      })
      const parsed = safeJson(identityContent)
      if (!parsed || !Array.isArray(parsed.layers)) return response.status(422).json({ error: '层检测返回格式无法解析，请重试' })
      layers = parsed.layers.filter((l) => typeof l === 'string')
      quality = { level: parsed.quality === 'low' ? 'low' : 'high', reason: parsed.qualityReason || '' }
      identity = parsed.identity || null

      // 医嘱线 OCR：仅当存在处方层或医院标签层时才需要文字（药盒层不提取用法用量）
      if (layers.includes('处方层') || layers.includes('医院标签层')) {
        const textContent = await chatCompletion({
          baseUrl: cleanBaseUrl(process.env.QWEN_BASE_URL, 'https://llm-fazbhtxxim0fqh5e.cn-beijing.maas.aliyuncs.com/api/v1'),
          apiKey: process.env.QWEN_API_KEY,
          model: process.env.QWEN_VL_MODEL || 'qwen3.5-ocr',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: image } },
                { type: 'text', text: '请逐行转录这张图片中的全部文字，保持原始行顺序，不要添加任何注释、翻译或总结。' },
              ],
            },
          ],
        })
        ocrText = textContent
      }
    }

    const warning = entryWarning(entry, layers)
    if (layers.includes('不支持')) {
      return response.json({
        ok: false,
        mode,
        entry,
        layers,
        quality,
        unsupported: true,
        error: '层检测不支持该对象（如散装药片）。请勿根据无法识别的内容服药，可通过「手动建档」录入，或咨询药师。',
      })
    }
    if (quality.level === 'low') {
      return response.json({
        ok: false,
        mode,
        entry,
        layers,
        quality,
        error: `图片质量问题：${quality.reason || '不清晰'}。建议针对该问题重拍：避免反光、保证光线充足、完整入镜。`,
      })
    }

    // 医嘱线解析 + L2 兜底脱敏
    const audit = {}
    const prescription = parsePrescriptionText(ocrText)
    const labelInfo = layers.includes('医院标签层') ? parseLabelText(ocrText) : null
    for (const key of ['hospital', 'department', 'diagnosis']) {
      prescription[key] = scrubValue(prescription[key], audit)
    }
    const sanitized = Object.entries(audit).map(([type, count]) => ({ type, count }))
    // 演示样例的「原文对照」：对合成原文做同样的兜底脱敏后返回（真实模式下 OCR 原文不回传，以用户上传图片为对照）
    let rawText = null
    if (mode === 'demo' && ocrText) {
      const displayAudit = {}
      rawText = scrubValue(ocrText, displayAudit)
    }

    const hasPrescriptionLayer = layers.includes('处方层')
    const hasLabelLayer = layers.includes('医院标签层')
    const hasBoxLayer = layers.includes('药盒原装层')
    const hasSigSource = hasPrescriptionLayer || hasLabelLayer

    // 条目来源：处方层用 Rp 条目，标签层用整段标签文本；仅药盒层时用身份线做「仅建档」草稿
    let sourceItems = []
    if (hasPrescriptionLayer && prescription.items.length > 0) {
      sourceItems = prescription.items
    } else if (hasLabelLayer) {
      sourceItems = [
        {
          name: identity?.genericName || '',
          spec: identity?.specification || '',
          quantity: '',
          sig: labelInfo?.sig || {},
          sigText: labelInfo?.sigText || '',
          raw: ocrText,
        },
      ]
    } else if (identity?.genericName) {
      sourceItems = [
        {
          name: identity.genericName,
          spec: identity.specification || '',
          quantity: '',
          sig: {},
          sigText: '',
          raw: ocrText || '',
        },
      ]
    }

    if (entry === 'A' && !hasPrescriptionLayer) {
      return response.json({
        ok: false,
        mode,
        entry,
        layers,
        quality,
        sanitized,
        error: '未在图片中识别到处方内容（需要包含 Rp 至处方完毕）。请重拍平铺完整的处方笺，或切换到「拍药品」入口。',
      })
    }

    // 逐条目装配草稿（一张处方笺含多个药品时拆分为 N 份档案+计划草稿）
    const items = sourceItems.map((item) => {
      const itemIdentity = identity || {}
      const effectiveIdentity = {
        ...itemIdentity,
        genericName: itemIdentity.genericName || item.name,
        specification: itemIdentity.specification || item.spec,
        form: itemIdentity.form || formFromName(item.name),
      }
      const matchResult = matchItem({ itemName: item.name, itemSpec: item.spec, identity: effectiveIdentity })
      const matchedDrug = matchResult.match
      const insert = matchedDrug ? packageInserts.find((p) => p.drugId === matchedDrug.id) : null

      const plan = hasSigSource
        ? buildPlanDraft({
            sig: item.sig,
            baseDate: prescription.date || labelInfo?.date || new Date().toISOString().slice(0, 10),
            hasLabelSource: hasLabelLayer && !hasPrescriptionLayer,
          })
        : null

      const conflicts = [...matchResult.conflicts]
      if (labelInfo && labelInfo.dropCounts.length > 1) {
        conflicts.push({
          type: 'layer',
          note: `层间信息冲突：标签标注约 ${labelInfo.dropCounts[0]} 滴 vs 盒面约 ${labelInfo.dropCounts[1]} 滴。库存估算请以实物核对为准，系统不裁决。`,
        })
      }
      const draft = {
        identity: effectiveIdentity,
        whitelistItem: { name: item.name, spec: item.spec, quantity: item.quantity, sigText: item.sigText, raw: item.raw },
        matchStatus: matchResult.matchStatus,
        matchedDrug,
        resolutionNote: matchResult.resolutionNote,
        conflicts,
        plan,
        otcNote:
          !hasSigSource && hasBoxLayer
            ? '该药识别为自购 OTC 药盒：仅完成建档，服药计划由你按说明书手动创建。药盒上的用法用量是说明书通用剂量，不是医嘱。'
            : null,
        healthSuggestions: [],
        rangeCheck: plan ? rangeCheck({ dose: plan.dose, frequency: plan.frequency }, insert) : { status: 'none', issues: [] },
        interactions: matchedDrug ? checkInteractionHits(matchedDrug.id, activeDrugIds) : { has: false, items: [] },
      }
      return draft
    })

    // 健康信息「建议填入」：处方笺识别出的诊断/性别/年龄，用户勾选才写入（PRD §7.1.2 入口二）
    const healthSuggestions = []
    if (prescription.diagnosis) healthSuggestions.push({ field: '诊断', value: prescription.diagnosis, source: '处方笺抄录' })
    if (prescription.patientHint.gender) healthSuggestions.push({ field: '性别', value: prescription.patientHint.gender, source: '处方笺抄录' })
    if (prescription.patientHint.age != null) healthSuggestions.push({ field: '年龄', value: `${prescription.patientHint.age} 岁`, source: '处方笺抄录' })
    if (hasPrescriptionLayer) items.forEach((item) => (item.healthSuggestions = healthSuggestions))

    if (items.length === 0) {
      return response.json({
        ok: false,
        mode,
        entry,
        layers,
        quality,
        sanitized,
        error:
          entry === 'A'
            ? '医嘱线未从图片中提取到处方条目。请重拍（平铺完整、覆盖 Rp 至处方完毕），或切换到「拍药品」入口。'
            : '身份线未识别到药品信息。请补拍正面清晰的药盒，或使用手动建档。',
      })
    }

    response.json({
      ok: true,
      mode,
      entry,
      layers,
      layerWarning: warning,
      quality,
      sanitized,
      prescription: hasPrescriptionLayer
        ? {
            hospital: prescription.hospital,
            rxNo: prescription.rxNo,
            date: prescription.date,
            department: prescription.department,
            diagnosis: prescription.diagnosis,
          }
        : null,
      patientHint: prescription.patientHint || null,
      items,
      rawText,
      message: `已生成 ${items.length} 份档案+计划草稿，请在确认页逐项核对后生效。`,
      source: mode === 'demo' ? '演示样例（合成化 golden case）+ 规则解析' : 'Qwen3-VL（层检测+身份线）+ OCR 转录（医嘱线）+ 规则解析',
    })
  } catch (error) {
    console.error('Extract request failed:', error instanceof Error ? error.message : error)
    response.status(502).json({ error: `提取服务调用失败：${error instanceof Error ? error.message : '未知错误'}` })
  }
})

// 相互作用检查（计划变更导致用药集合变化时重跑，PRD V2 §7.8.2 时机二）
app.post('/api/interactions', (request, response) => {
  const ids = [...new Set([...(request.body?.activeDrugIds || [])])].filter((id) => typeof id === 'string')
  const hits = interactionRules.filter((rule) => rule.drugs.every((id) => ids.includes(id)))
  response.json({
    has: hits.length > 0,
    items: hits.map((h) => ({ level: h.level, note: h.note, source: h.source, drugs: h.drugs })),
    coverage: '演示规则库仅覆盖 Mock 药品之间的已知组合；未覆盖不表示无风险。',
  })
})

// 草稿复核：确认页中用户解决冲突候选 / 人工补全字段后，重跑说明书范围校验与相互作用检查
app.post('/api/draft-check', (request, response) => {
  const { drugId, dose, frequency, activeDrugIds } = request.body || {}
  if (!drugId) return response.status(400).json({ error: '请提供 drugId' })
  const insert = packageInserts.find((p) => p.drugId === drugId)
  response.json({
    rangeCheck: rangeCheck(
      { dose: dose && dose.value ? dose : null, frequency: Number(frequency) || null },
      insert,
    ),
    interactions: checkInteractionHits(drugId, activeDrugIds),
  })
})

// ---------------------------------------------------------------------------
// AI 用药咨询（PRD V2 §7.5）
// 本地说明书库为主源，按键取数（drugId 直查、按段取字段），不使用 RAG；
// 医疗搜索默认关闭，本地未命中不兜底（演示版），回答必须携带 citations。
// ---------------------------------------------------------------------------
function findInsertByDrug(drug) {
  let insert = packageInserts.find((p) => p.drugId === drug.id)
  if (!insert && drug.confirmStatus === 'manual') {
    // 手动建档（未经 OCR 确认）仅可做 L0 资料查询：按药名匹配说明书，不进入个体化解释
    insert = packageInserts.find((p) => nameMatches(drug.genericName, p.genericName))
  }
  return insert || null
}

function insertCitation(insert) {
  return `${insert.genericName}（${insert.brandName}）说明书 · ${insert.source} · 版本 ${insert.version}`
}

// 按问题类型取对应段落（结构化取数优先于语义检索）
function pickInsertSections(question, insert) {
  const q = String(question || '')
  const join = (arr) => (Array.isArray(arr) ? arr.join('；') : arr)
  if (/药理|机制|原理|机理|起效|怎么作用|为什么有效/.test(q)) {
    return { label: '药理毒理段', text: `药理作用：${insert.pharmacology || '（未收录）'}；药代动力学：${insert.pharmacokinetics || '（未收录）'}` }
  }
  if (/相互作用|一起|联用|同时|搭配|共同/.test(q)) {
    return { label: '相互作用段', text: `相互作用：${insert.interactions || '（未收录）'}` }
  }
  if (/不良|副作用|反应|不适/.test(q)) {
    return { label: '不良反应段', text: `不良反应：${insert.adverseReactions || '（未收录）'}` }
  }
  if (/禁忌|不能|过敏/.test(q)) {
    return { label: '禁忌段', text: `禁忌：${join(insert.contraindications) || '（未收录）'}` }
  }
  if (/成分|辅料|含有|含什么/.test(q)) {
    return { label: '成份段', text: `成份：${insert.components || '（未收录）'}` }
  }
  if (/注意|事项|小心/.test(q)) {
    return { label: '注意事项段', text: `注意事项：${join(insert.precautions) || '（未收录）'}` }
  }
  if (/保存|储存|存放|存/.test(q)) {
    return { label: '储存说明', text: `储存：${insert.storage || join(insert.precautions) || '请按包装和说明书要求保存'}` }
  }
  if (/怎么吃|怎么用|用法|用量|吃几|用几|频次/.test(q)) {
    return { label: '医嘱提示', text: '用法用量属于医嘱范畴，本助手不提供具体剂量、频次、疗程数字，请按医生处方或药师指导执行。' }
  }
  return { label: '适应症段', text: `适应症：${insert.indication || '（未收录）'}` }
}

function normalizeSections(raw, context) {
  const summary = stripDosageAdvice(raw?.summary)
  const keyPoints = (Array.isArray(raw?.keyPoints) ? raw.keyPoints : [])
    .slice(0, 3)
    .map(stripDosageAdvice)
    .filter(Boolean)
  const risks = (Array.isArray(raw?.risks) ? raw.risks : [])
    .slice(0, 3)
    .map(sanitizeText)
    .filter(Boolean)
  const nextAction = sanitizeText(raw?.nextAction || '如有疑问，请咨询医生或药师。')
  const warning = sanitizeText(raw?.warning || '不要根据 AI 回答自行调整处方。')
  const limited = [summary, ...keyPoints, nextAction].some(containsDosageAdvice)

  return {
    summary: summary || context?.summaryFallback || '暂时无法给出确定结论，请查看药品说明书或咨询医生、药师。',
    keyPoints: keyPoints.length ? keyPoints : context?.keyPointsFallback || [],
    risks: risks.length ? risks : context?.risksFallback || [],
    nextAction: limited ? '具体用量和疗程请按医生处方或说明书执行。' : nextAction,
    warning,
    limited,
  }
}

// 离线降级：无 BAICHUAN_API_KEY 时用说明书库规则拼装确定性回答
function fallbackSectionsFromInsert(question, insert) {
  const section = pickInsertSections(question, insert)
  return normalizeSections(
    {
      summary: section.text.replace(/^[^：:]+[：:]/, '').slice(0, 120),
      keyPoints: (insert.precautions || []).slice(0, 2),
      risks: (insert.contraindications || []).slice(0, 2),
      nextAction: '如有疑问，请咨询医生或药师。',
      warning: '不要根据 AI 回答自行调整处方。',
    },
    {
      summaryFallback: `${insert.genericName}的资料请以说明书为准。`,
      keyPointsFallback: [insert.indication].filter(Boolean),
      risksFallback: (insert.contraindications || []).slice(0, 2),
    },
  )
}

app.post('/api/consult', async (request, response) => {
  const question = String(request.body?.question || '').trim()
  const drug = request.body?.drug
  const activeDrugIds = request.body?.activeDrugIds || []
  if (!question) return response.status(400).json({ error: '请输入咨询问题' })
  if (!drug?.genericName) return response.status(400).json({ error: '请先选择经过确认的药品' })

  if (emergencyPattern.test(question)) {
    return response.json({
      riskLevel: 'L4',
      status: 'emergency',
      answer: '你描述的情况可能需要紧急处理。请立即拨打当地急救电话或尽快前往急诊，不要等待 AI 继续判断。请携带相关药品包装、说明书和已知服药量。',
      sections: {
        summary: '你描述的情况可能需要紧急处理。',
        keyPoints: [],
        risks: ['不要等待 AI 继续判断，也不要自行处理。'],
        nextAction: '请立即拨打当地急救电话或尽快前往急诊，并携带药品包装、说明书和已知服药量。',
        warning: '紧急情况下，AI 不能替代急救或专业医疗评估。',
      },
      citations: [],
    })
  }
  if (prohibitedPattern.test(question)) {
    return response.json({
      riskLevel: 'L3',
      status: 'refused',
      answer: '我不能根据当前信息建议你增减剂量、停药或换药。这类调整需要结合诊断、检查结果和完整用药情况，由开具处方的医生或药师判断。',
      sections: {
        summary: '我不能建议你自行增减剂量、停药或换药。',
        keyPoints: ['用药调整需要结合诊断、检查结果和完整用药情况。'],
        risks: ['自行调整可能导致治疗失败、不良反应或其他风险。'],
        nextAction: '请联系开具处方的医生或药师。',
        warning: '不要根据 AI 回答自行调整处方。',
      },
      citations: [],
    })
  }

  // 药品确认状态三档（PRD V2 §7.5）：手动建档档仅可做 L0 资料查询
  const isManual = drug.confirmStatus === 'manual'
  const insert = findInsertByDrug(drug)
  if (!insert) {
    return response.json({
      riskLevel: 'L1',
      status: 'no-source',
      answer: `本地说明书库未收录「${drug.genericName}」，医疗搜索默认关闭（演示版未开启网络检索兜底），我无法提供可追溯的资料解释。请查看药品说明书或咨询医生、药师。`,
      sections: {
        summary: `本地说明书库未收录「${drug.genericName}」，无法提供可追溯的资料解释。`,
        keyPoints: ['本地说明书库按 drugId 直查，该药品未命中', '演示版医疗搜索默认关闭，未开启网络检索兜底'],
        risks: [],
        nextAction: '请查看药品说明书或咨询医生、药师。',
        warning: '不要根据未标注来源的网络资料自行调整用药。',
      },
      citations: [],
      notice: '正式版在本地说明书库未命中时会开启医疗搜索兜底，且回答标注「基于网络检索，未经本库核实」。',
    })
  }

  // 相互作用提示由规则库按「生效计划集合」匹配后随提问一并注入（PRD V2 §7.5）
  const interactionContext = checkInteractionHits(drug.id, activeDrugIds)
  const section = pickInsertSections(question, insert)
  const l0Notice = isManual
    ? '该药品为手动建档（未经 OCR 确认），以下仅为一般性资料查询（L0），不构成个体化用药解释。'
    : undefined

  if (!process.env.BAICHUAN_API_KEY) {
    const fallback = fallbackSectionsFromInsert(question, insert)
    return response.json({
      riskLevel: 'L1',
      status: 'answered',
      answer: fallback.summary,
      sections: fallback,
      citations: [insertCitation(insert)],
      notice: '未配置 BAICHUAN_API_KEY，回答由本地说明书库规则拼装（演示降级）。',
      l0Notice,
    })
  }

  try {
    const rawAnswer = await chatCompletion({
      baseUrl: cleanBaseUrl(process.env.BAICHUAN_BASE_URL, 'https://api.baichuan-ai.com/v1'),
      apiKey: process.env.BAICHUAN_API_KEY,
      model: process.env.BAICHUAN_MODEL || 'Baichuan-M3-Plus',
      messages: [
        {
          role: 'user',
          content: `你是“安心用药”演示版药品资料解释助手，基于已确认药品的本地说明书库回答问题。

硬性规则：
1. 只输出严格 JSON，禁止 Markdown、禁止 **粗体**、禁止 ^[1]^ 这类引用编号。
2. 总字数控制在 150-250 个汉字。
3. 不得给出具体剂量、频次、疗程数字，不得说“一日X片/每次X mg”。
4. 不得诊断、开处方、建议停换药；不预测个体疗效（“对你效果如何”不回答）。
5. 解释药理作用时使用通俗语言，说明“是什么、为什么这样用”。
6. 只基于下方提供的说明书段落与相互作用资料回答，资料未覆盖的内容明确说明，不要编造。
7. 不要结尾追问。

JSON 格式：
{"summary":"一句话直接回答","keyPoints":["最多3条"],"risks":["最多3条"],"nextAction":"下一步建议","warning":"不要自行调整处方的提示"}

已确认药品：${insert.genericName}（${insert.brandName}）；规格：${insert.specification}；剂型：${insert.form}。
${isManual ? '注意：该药品为用户手动建档（未经 OCR 确认），回答仅做一般性资料解释（L0），不得结合个体情况展开。' : ''}
本次取用的说明书段落（${section.label}，版本 ${insert.version}）：
${section.text}

${interactionContext.has ? `生效计划集合中的相互作用提示（规则库抄录，需在回答中提示用户关注）：\n${interactionContext.items.map((i) => `- [${i.level}] ${i.note}（来源：${i.source}）`).join('\n')}` : '生效计划集合中未见已知相互作用（演示规则库覆盖有限，未覆盖不表示无风险）。'}

用户问题：${question}`,
        },
      ],
    })

    const parsed = safeJson(rawAnswer)
    const sections = parsed
      ? normalizeSections(parsed, {
          summaryFallback: section.text.replace(/^[^：:]+[：:]/, '').slice(0, 120),
          keyPointsFallback: (insert.precautions || []).slice(0, 2),
          risksFallback: (insert.contraindications || []).slice(0, 2),
        })
      : fallbackSectionsFromInsert(question, insert)

    response.json({
      riskLevel: sections.limited ? 'L2' : 'L1',
      status: sections.limited ? 'limited' : 'answered',
      answer: sections.summary,
      sections,
      citations: [insertCitation(insert)],
      notice: sections.limited ? '已过滤具体剂量建议。用量请按医生处方或说明书执行。' : undefined,
      l0Notice,
    })
  } catch (error) {
    console.error('Consult request failed:', error instanceof Error ? error.message : error)
    response.status(502).json({ error: `百川服务调用失败：${error instanceof Error ? error.message : '未知错误'}` })
  }
})

// ---------------------------------------------------------------------------
// 患者洞察 Agent · Mock 数据与只读工具（对应 docs/04 阶段 B，沿用 V1）
// ---------------------------------------------------------------------------

function recentDates(days) {
  const today = new Date(mockData.baseDate)
  const list = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    list.push(d.toISOString().slice(0, 10))
  }
  return list
}

function buildRecords(drugId, days, rate, tailSkip = 0) {
  const dates = recentDates(days)
  const cutoff = dates.length - tailSkip
  return dates.map((date, idx) => {
    if (idx >= cutoff) return { date, drugId, status: 'skipped' }
    const seed = (date.charCodeAt(8) + date.charCodeAt(9) + drugId.length) % 100
    const status = seed < rate * 100 ? 'taken' : 'skipped'
    return { date, drugId, status }
  })
}

const mockPatients = mockData.patients.map((p) => ({
  ...p,
  records: (p.recordPresets || []).flatMap((preset) =>
    buildRecords(preset.drugId, mockData.recordDays, preset.rate, preset.tailSkip),
  ),
  recordPresets: undefined,
}))

function findPatient(patientId) {
  return mockPatients.find((p) => p.id === patientId) || null
}

function getAdherence(patient, dateRange = 30) {
  const records = patient.records.filter((r) => {
    const cutoff = recentDates(dateRange)[0]
    return r.date >= cutoff
  })
  const total = records.length
  const taken = records.filter((r) => r.status === 'taken').length
  const skipped = records.filter((r) => r.status === 'skipped').length
  const rate = total ? Math.round((taken / total) * 100) : 0

  const sorted = [...records].sort((a, b) => (a.date < b.date ? 1 : -1))
  let consecutiveSkip = 0
  for (const r of sorted) {
    if (r.status === 'skipped') consecutiveSkip++
    else break
  }

  const skipDetails = sorted
    .filter((r) => r.status === 'skipped')
    .slice(0, 5)
    .map((r) => ({ date: r.date, drugId: r.drugId }))

  return { rate, taken, skipped, total, consecutiveSkip, skipDetails, dateRange }
}

function getMedicationList(patient) {
  return patient.drugIds
    .map((id) => mockDrugCatalog.find((d) => d.id === id))
    .filter(Boolean)
    .map((d) => ({
      id: d.id,
      genericName: d.genericName,
      brandName: d.brandName,
      specification: d.specification,
      form: d.form,
      stock: d.stock,
      expiry: d.expiry,
    }))
}

function checkInteractions(patient) {
  const ids = patient.drugIds
  const hits = interactionRules.filter((rule) => rule.drugs.every((id) => ids.includes(id)))
  return {
    hasInteraction: hits.length > 0,
    items: hits.map((h) => ({ level: h.level, note: h.note, drugs: h.drugs })),
  }
}

function checkExpiryStock(patient) {
  const today = new Date('2026-07-21')
  const meds = getMedicationList(patient)
  const expiring = []
  const expired = []
  const lowStock = []
  for (const m of meds) {
    if (!m.expiry || m.expiry === '待录入' || m.expiry === '待药盒读取') continue
    const exp = new Date(m.expiry)
    if (Number.isNaN(exp.getTime())) continue
    const days = Math.round((exp - today) / (1000 * 60 * 60 * 24))
    if (days < 0) expired.push({ ...m, days })
    else if (days <= 30) expiring.push({ ...m, days })
    if (m.stock <= 10) lowStock.push({ ...m })
  }
  return { expiring, expired, lowStock }
}

function getRiskEvents(patient) {
  const events = patient.riskEvents || []
  const consult = patient.consultHistory || {}
  return {
    events,
    consultCount: consult.count || 0,
    lastQuestion: consult.lastQuestion || '',
    blockedCount: consult.blockedCount || 0,
    hasL4: events.some((e) => e.level === 'L4'),
    hasL3: events.some((e) => e.level === 'L3'),
  }
}

function guardSummary(sections) {
  const summary = sections.summary || ''
  const keyPoints = Array.isArray(sections.keyPoints) ? sections.keyPoints : []
  const nextAction = sections.nextAction || ''
  const combined = [summary, ...keyPoints, nextAction].join(' ')

  if (emergencyPattern.test(combined)) {
    return {
      riskLevel: 'L4',
      sections: {
        summary: '摘要涉及紧急风险信号，建议立即联系患者或引导就医。',
        keyPoints: ['该患者近期可能存在需要紧急处理的情况'],
        risks: ['不要等待 AI 继续判断'],
        nextAction: '请立即联系患者或引导其前往急诊。',
        warning: '紧急情况下，AI 不能替代急救或专业医疗评估。',
      },
    }
  }
  if (prohibitedPattern.test(combined)) {
    return {
      riskLevel: 'L3',
      sections: {
        summary: '摘要已被安全守门拦截：不得建议自行增减剂量、停药或换药。',
        keyPoints: ['用药调整需结合诊断与检查结果，由开方医生判断'],
        risks: ['自行调整可能导致治疗失败或不良反应'],
        nextAction: '请结合处方与患者实际情况判断，必要时联系开方医生。',
        warning: '不要根据 AI 摘要自行调整处方。',
      },
    }
  }
  const cleanedSummary = stripDosageAdvice(summary)
  const cleanedKeyPoints = keyPoints.map(stripDosageAdvice).filter(Boolean)
  const cleanedNext = stripDosageAdvice(nextAction)
  const limited = [cleanedSummary, ...cleanedKeyPoints, cleanedNext].some(containsDosageAdvice)
  if (limited) {
    return {
      riskLevel: 'L2',
      sections: {
        summary: cleanedSummary || '已过滤具体剂量建议。用量请按处方或说明书执行。',
        keyPoints: cleanedKeyPoints.length ? cleanedKeyPoints : ['具体用量请按医生处方执行'],
        risks: Array.isArray(sections.risks) ? sections.risks.slice(0, 3) : [],
        nextAction: '具体用量和疗程请按医生处方或说明书执行。',
        warning: sections.warning || '不要根据 AI 摘要自行调整处方。',
      },
    }
  }
  return {
    riskLevel: 'L1',
    sections: {
      summary: cleanedSummary,
      keyPoints: cleanedKeyPoints,
      risks: Array.isArray(sections.risks) ? sections.risks.slice(0, 3).map(sanitizeText).filter(Boolean) : [],
      nextAction: cleanedNext || '如有疑问，请咨询医生或药师。',
      warning: sections.warning || '不要根据 AI 摘要自行调整处方。',
    },
  }
}

function fallbackPatientSummary(patient, tools) {
  const { adherence, medicationList, interactions, expiry, riskEvents } = tools
  const keyPoints = []
  const risks = []

  keyPoints.push(`近 ${adherence.dateRange} 天整体服药执行率 ${adherence.rate}%（已服 ${adherence.taken}/${adherence.total} 次）`)
  if (adherence.consecutiveSkip > 0) {
    keyPoints.push(`连续漏服 ${adherence.consecutiveSkip} 次，建议诊间询问漏服原因`)
    risks.push(`连续漏服可能影响慢病控制效果`)
  }
  if (interactions.hasInteraction) {
    keyPoints.push(`存在 ${interactions.items.length} 项药物相互作用提示`)
    risks.push(interactions.items[0]?.note || '部分药品联用需关注')
  }
  if (expiry.expiring.length > 0) {
    keyPoints.push(`${expiry.expiring.length} 种药品临期（≤30 天）`)
    risks.push('临期药品需确认是否继续使用')
  }
  if (riskEvents.hasL4) {
    risks.push('近期命中过紧急风险关键词，已引导急救')
  }
  if (riskEvents.blockedCount > 0) {
    keyPoints.push(`咨询中被安全规则拦截 ${riskEvents.blockedCount} 次（多为停换药疑问）`)
  }

  return {
    summary: `患者 ${patient.name}（${patient.age} 岁，${patient.gender}）近 ${adherence.dateRange} 天服药执行率 ${adherence.rate}%，${adherence.consecutiveSkip > 0 ? `连续漏服 ${adherence.consecutiveSkip} 次` : '无明显连续漏服'}，${interactions.hasInteraction ? '存在药物相互作用提示' : '未见明确相互作用'}。`,
    keyPoints: keyPoints.slice(0, 3),
    risks: risks.slice(0, 3),
    nextAction: '依处方判断是否需要调整，并向患者确认漏服原因与近期不适。',
    warning: '本摘要基于患者自报数据，仅供参考，不构成诊疗或用药调整依据。',
  }
}

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    qwenConfigured: Boolean(process.env.QWEN_API_KEY),
    baichuanConfigured: Boolean(process.env.BAICHUAN_API_KEY),
    masterDrugCount: masterDrugs.length,
    packageInsertCount: packageInserts.length,
    interactionRuleCount: interactionRules.length,
  })
})

app.get('/api/insight/patients', (_request, response) => {
  response.json({
    ok: true,
    patients: mockPatients.map((p) => ({
      id: p.id,
      name: p.name,
      age: p.age,
      gender: p.gender,
      conditions: p.conditions,
      drugCount: p.drugIds.length,
      enrolledAt: p.enrolledAt,
      lastActiveAt: p.lastActiveAt,
    })),
  })
})

app.post('/api/insight/summary', async (request, response) => {
  const patientId = String(request.body?.patientId || '').trim()
  if (!patientId) return response.status(400).json({ error: '请提供 patientId' })
  const patient = findPatient(patientId)
  if (!patient) return response.status(404).json({ error: '未找到该患者，请确认 patientId' })

  const toolChain = ['getAdherence', 'getMedicationList', 'checkInteractions', 'checkExpiryStock', 'getRiskEvents']

  const adherence = getAdherence(patient, 30)
  const medicationList = getMedicationList(patient)
  const interactions = checkInteractions(patient)
  const expiry = checkExpiryStock(patient)
  const riskEvents = getRiskEvents(patient)
  const tools = { adherence, medicationList, interactions, expiry, riskEvents }

  const dateRange = `${recentDates(30)[0]} ~ ${recentDates(30)[29]}`
  const generatedAt = new Date().toISOString()

  if (!process.env.BAICHUAN_API_KEY) {
    const fallback = fallbackPatientSummary(patient, tools)
    return response.json({
      patient: {
        id: patient.id, name: patient.name, age: patient.age, gender: patient.gender,
        conditions: patient.conditions, enrolledAt: patient.enrolledAt, lastActiveAt: patient.lastActiveAt,
      },
      riskLevel: 'L1',
      sections: fallback,
      tools,
      snapshot: { generatedAt, dateRange, toolChain, mode: 'offline-fallback' },
      citations: ['本地 Mock 患者数据（演示数据，未经医学审核）'],
      notice: '未配置 BAICHUAN_API_KEY，摘要为规则降级生成。',
    })
  }

  try {
    const rawAnswer = await chatCompletion({
      baseUrl: cleanBaseUrl(process.env.BAICHUAN_BASE_URL, 'https://api.baichuan-ai.com/v1'),
      apiKey: process.env.BAICHUAN_API_KEY,
      model: process.env.BAICHUAN_MODEL || 'Baichuan-M3-Plus',
      messages: [
        {
          role: 'user',
          content: `你是“安心用药”演示版的患者洞察助手，为医生生成诊前用药摘要。只基于以下工具输出的事实生成摘要，不要编造数据。

硬性规则：
1. 只输出严格 JSON，禁止 Markdown、禁止 **粗体**、禁止引用编号。
2. 总字数控制在 150-250 个汉字。
3. 不得给出具体剂量、频次、疗程数字，不得说“一日X片/每次X mg”。
4. 不得诊断、开处方、建议停换药或调整剂量。
5. 摘要面向医生，用于诊前快速了解患者用药情况，不是用药建议。
6. 不要结尾追问。

JSON 格式：
{"summary":"一句话概括患者近期用药情况","keyPoints":["最多3条关键发现"],"risks":["最多3条风险提示"],"nextAction":"下一步建议（指向诊间确认或联系医生）","warning":"提醒医生本摘要仅供参考"}

患者：${patient.name}，${patient.age}岁，${patient.gender}，慢病：${patient.conditions.join('、')}。
数据区间：${dateRange}（近 30 天）。

工具输出（均为只读计算结果）：
- 依从性：执行率 ${adherence.rate}%（已服 ${adherence.taken}/${adherence.total}），连续漏服 ${adherence.consecutiveSkip} 次${adherence.consecutiveSkip > 0 ? '，漏服明细 ' + adherence.skipDetails.map((s) => s.date).join('、') : ''}
- 用药清单（${medicationList.length} 种）：${medicationList.map((m) => m.genericName).join('、')}
- 相互作用：${interactions.hasInteraction ? interactions.items.map((i) => i.level + '：' + i.note).join('；') : '未见明确相互作用'}
- 临期库存：临期 ${expiry.expiring.length} 种、过期 ${expiry.expired.length} 种、低库存 ${expiry.lowStock.length} 种
- 风险事件：L4 紧急 ${riskEvents.hasL4 ? '有' : '无'}、L3 拒答 ${riskEvents.hasL3 ? '有' : '无'}；咨询被拦截 ${riskEvents.blockedCount} 次；最近咨询：“${riskEvents.lastQuestion}”

请基于以上事实生成诊前摘要。`,
        },
      ],
    })

    const parsed = safeJson(rawAnswer)
    const rawSections = parsed || fallbackPatientSummary(patient, tools)
    const guarded = guardSummary(rawSections)

    response.json({
      patient: {
        id: patient.id, name: patient.name, age: patient.age, gender: patient.gender,
        conditions: patient.conditions, enrolledAt: patient.enrolledAt, lastActiveAt: patient.lastActiveAt,
      },
      riskLevel: guarded.riskLevel,
      sections: guarded.sections,
      tools,
      snapshot: { generatedAt, dateRange, toolChain, mode: 'llm' },
      citations: ['本地 Mock 患者数据（演示数据，未经医学审核）'],
      notice: guarded.riskLevel === 'L2' ? '已过滤具体剂量建议。用量请按医生处方或说明书执行。' : undefined,
    })
  } catch (error) {
    console.error('Insight summary failed:', error instanceof Error ? error.message : error)
    const fallback = fallbackPatientSummary(patient, tools)
    response.json({
      patient: {
        id: patient.id, name: patient.name, age: patient.age, gender: patient.gender,
        conditions: patient.conditions, enrolledAt: patient.enrolledAt, lastActiveAt: patient.lastActiveAt,
      },
      riskLevel: 'L1',
      sections: fallback,
      tools,
      snapshot: { generatedAt, dateRange, toolChain, mode: 'error-fallback' },
      citations: ['本地 Mock 患者数据（演示数据，未经医学审核）'],
      notice: `LLM 调用失败，已降级为规则摘要：${error instanceof Error ? error.message : '未知错误'}`,
    })
  }
})

app.use(express.static(staticDir))
app.get(/^\/(?!api).*/, (_request, response, next) => {
  // SPA 路由回退：非 /api 开头的请求统一返回 index.html
  response.sendFile(join(staticDir, 'index.html'), (error) => next(error))
})

app.use((error, _request, response, _next) => {
  if (error?.type === 'entity.too.large') return response.status(413).json({ error: '上传内容过大' })
  console.error(error)
  response.status(500).json({ error: '服务端处理失败' })
})

app.listen(port, () => {
  console.log(`API server ready at http://localhost:${port}`)
  console.log(`Static files served from ${staticDir}`)
  console.log(`数据资产：身份库 ${masterDrugs.length} 条 / 说明书库 ${packageInserts.length} 条 / 相互作用规则 ${interactionRules.length} 条`)
})
