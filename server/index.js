import 'dotenv/config'
import express from 'express'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const app = express()
const port = Number(process.env.PORT || 8787)
const __dirname = dirname(fileURLToPath(import.meta.url))
const staticDir = join(__dirname, '..', 'dist')

app.use(express.json({ limit: '22mb' }))

const mockDrugs = [
  {
    id: 'mock-amlodipine-5',
    genericName: '苯磺酸氨氯地平片',
    brandName: '络活喜（演示数据）',
    specification: '5 mg × 7片',
    form: '片剂',
    manufacturer: '辉瑞制药有限公司',
    approval: '国药准字H10950224',
    stock: 28,
    expiry: '2027-12-31',
  },
  {
    id: 'mock-cefuroxime-axetil-025',
    genericName: '头孢呋辛酯片',
    brandName: '达力新（演示数据）',
    specification: '0.25 g × 12片',
    form: '片剂',
    manufacturer: '国药集团致君（深圳）制药有限公司',
    approval: '包装正面未显示，待核对',
    stock: 12,
    expiry: '待录入',
  },
]

const emergencyPattern = /胸痛|呼吸困难|意识异常|昏迷|抽搐|大量误服|儿童误服|严重过敏|喉头紧缩|呕血|黑便|大量出血|自杀|自伤/
const prohibitedPattern = /停药|换药|增量|减量|加量|改剂量|改成.*片|应该吃几片|能吃几片/
const dosageOutputPattern =
  /一日\s*[\d.]+|每天\s*[\d.]+|每次\s*[\d.]+|分\s*\d+\s*次|[\d.]+\s*(?:mg|g|毫克|克|片|粒).{0,8}(?:一日|每天|每次|服用)|建议.{0,6}(?:服用|用量|剂量)/i

const drugProfiles = {
  'mock-amlodipine-5': {
    purpose: '常用于控制血压相关问题，需按医生处方使用。',
    storage: '密封、避光保存，放在儿童接触不到的地方。',
    risks: ['对成分过敏者禁用', '可能出现头晕、面部潮红等不适'],
    source: '本地 Mock 药品档案（演示数据，未经医学审核）',
  },
  'mock-cefuroxime-axetil-025': {
    purpose: '属于抗生素，通常用于敏感细菌引起的感染，对普通感冒等病毒感染无效。',
    storage: '按包装要求密封保存，避免受潮，放在儿童接触不到的地方。',
    risks: ['对头孢菌素类过敏者禁用', '可能出现恶心、腹泻等胃肠道不适'],
    source: '本地 Mock 药品档案（演示数据，未经医学审核）',
  },
}

// ---------------------------------------------------------------------------
// 患者洞察 Agent · Mock 数据与只读工具
// 对应 docs/04-患者洞察Agent方案设计.md 阶段 B
// 所有工具均为只读，工具层不存在任何调剂量/换药/停药/下发医嘱的写工具。
// ---------------------------------------------------------------------------

// Mock 相互作用规则表（演示用，未经医学审核，正式版需对接权威知识库）
const interactionRules = [
  { drugs: ['mock-amlodipine-5', 'mock-atorvastatin-20'], level: '中等', note: '氨氯地平与阿托伐他汀联用时，少数患者可能出现肌痛或肝酶升高，需关注。' },
  { drugs: ['mock-metformin-500', 'mock-glipizide-5'], level: '中等', note: '二甲双胍与格列吡嗪联用可能增加低血糖风险，需关注血糖监测。' },
]

// Mock 药品扩展档案（演示版新增药品，用于不同患者组合）
const mockDrugCatalog = [
  ...mockDrugs,
  {
    id: 'mock-atorvastatin-20',
    genericName: '阿托伐他汀钙片',
    brandName: '立普妥（演示数据）',
    specification: '20 mg × 7片',
    form: '片剂',
    manufacturer: '辉瑞制药有限公司',
    approval: '国药准字H20051408',
    stock: 14,
    expiry: '2026-08-15',
  },
  {
    id: 'mock-metformin-500',
    genericName: '盐酸二甲双胍片',
    brandName: '格华止（演示数据）',
    specification: '0.5 g × 20片',
    form: '片剂',
    manufacturer: '中美上海施贵宝制药有限公司',
    approval: '国药准字H20023370',
    stock: 30,
    expiry: '2027-06-30',
  },
  {
    id: 'mock-glipizide-5',
    genericName: '格列吡嗪片',
    brandName: '美吡达（演示数据）',
    specification: '5 mg × 30片',
    form: '片剂',
    manufacturer: '海南赞邦制药有限公司',
    approval: '国药准字H10930076',
    stock: 8,
    expiry: '2026-09-01',
  },
  {
    id: 'mock-omeprazole-20',
    genericName: '奥美拉唑肠溶胶囊',
    brandName: '洛赛克（演示数据）',
    specification: '20 mg × 14粒',
    form: '胶囊剂',
    manufacturer: '阿斯利康制药有限公司',
    approval: '国药准字H10940037',
    stock: 21,
    expiry: '2028-01-31',
  },
]

// 生成近 N 天的日期数组（YYYY-MM-DD），用于构造服药记录
function recentDates(days) {
  const today = new Date('2026-07-21') // 固定演示基准日，保证 Mock 数据稳定
  const list = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    list.push(d.toISOString().slice(0, 10))
  }
  return list
}

// 按执行率模式生成服药记录：rate 为已服比例，tailSkip 在末尾连续漏服天数
function buildRecords(drugId, days, rate, tailSkip = 0) {
  const dates = recentDates(days)
  const cutoff = dates.length - tailSkip
  return dates.map((date, idx) => {
    if (idx >= cutoff) return { date, drugId, status: 'skipped' }
    // 用确定性伪随机（基于日期 hash）保证每次刷新结果一致
    const seed = (date.charCodeAt(8) + date.charCodeAt(9) + drugId.length) % 100
    const status = seed < rate * 100 ? 'taken' : 'skipped'
    return { date, drugId, status }
  })
}

// Mock 患者数据集（8 名虚拟患者，覆盖不同依从性 / 相互作用 / 临期 / 风险事件场景）
const mockPatients = [
  {
    id: 'p-001', name: '张某某', age: 68, gender: '男',
    conditions: ['高血压', '2型糖尿病'],
    drugIds: ['mock-amlodipine-5', 'mock-metformin-500', 'mock-atorvastatin-20'],
    records: [
      ...buildRecords('mock-amlodipine-5', 30, 0.55, 3),
      ...buildRecords('mock-metformin-500', 30, 0.7, 1),
      ...buildRecords('mock-atorvastatin-20', 30, 0.8, 0),
    ],
    consultHistory: { count: 12, lastQuestion: '能不能把降压药停了', riskLevel: 'L3', blockedCount: 4 },
    riskEvents: [
      { date: '2026-07-20', level: 'L4', type: '紧急关键词', detail: '咨询命中"胸痛"，已引导拨打急救电话' },
      { date: '2026-07-15', level: 'L3', type: '拒答', detail: '询问能否停药，已引导联系开方医生' },
    ],
    enrolledAt: '2026-06-01', lastActiveAt: '2026-07-21',
  },
  {
    id: 'p-002', name: '李某某', age: 72, gender: '女',
    conditions: ['高血压', '高血脂'],
    drugIds: ['mock-amlodipine-5', 'mock-atorvastatin-20'],
    records: [
      ...buildRecords('mock-amlodipine-5', 30, 0.4, 5),
      ...buildRecords('mock-atorvastatin-20', 30, 0.5, 4),
    ],
    consultHistory: { count: 8, lastQuestion: '阿托伐他汀快过期了还能吃吗', riskLevel: 'L1', blockedCount: 0 },
    riskEvents: [],
    enrolledAt: '2026-06-10', lastActiveAt: '2026-07-19',
  },
  {
    id: 'p-003', name: '王某某', age: 65, gender: '男',
    conditions: ['2型糖尿病'],
    drugIds: ['mock-metformin-500', 'mock-glipizide-5'],
    records: [
      ...buildRecords('mock-metformin-500', 30, 0.92, 0),
      ...buildRecords('mock-glipizide-5', 30, 0.88, 0),
    ],
    consultHistory: { count: 5, lastQuestion: '二甲双胍应该饭前还是饭后吃', riskLevel: 'L1', blockedCount: 0 },
    riskEvents: [],
    enrolledAt: '2026-06-05', lastActiveAt: '2026-07-21',
  },
  {
    id: 'p-004', name: '赵某某', age: 58, gender: '女',
    conditions: ['胃溃疡', '高血压'],
    drugIds: ['mock-omeprazole-20', 'mock-amlodipine-5'],
    records: [
      ...buildRecords('mock-omeprazole-20', 30, 0.95, 0),
      ...buildRecords('mock-amlodipine-5', 30, 0.9, 0),
    ],
    consultHistory: { count: 3, lastQuestion: '奥美拉唑能长期吃吗', riskLevel: 'L1', blockedCount: 0 },
    riskEvents: [],
    enrolledAt: '2026-06-15', lastActiveAt: '2026-07-20',
  },
  {
    id: 'p-005', name: '孙某某', age: 75, gender: '男',
    conditions: ['高血压', '2型糖尿病', '高血脂'],
    drugIds: ['mock-amlodipine-5', 'mock-metformin-500', 'mock-atorvastatin-20', 'mock-glipizide-5'],
    records: [
      ...buildRecords('mock-amlodipine-5', 30, 0.6, 2),
      ...buildRecords('mock-metformin-500', 30, 0.65, 1),
      ...buildRecords('mock-atorvastatin-20', 30, 0.5, 3),
      ...buildRecords('mock-glipizide-5', 30, 0.7, 0),
    ],
    consultHistory: { count: 15, lastQuestion: '格列吡嗪能不能加量', riskLevel: 'L3', blockedCount: 6 },
    riskEvents: [
      { date: '2026-07-18', level: 'L3', type: '拒答', detail: '询问加量，已引导联系医生' },
    ],
    enrolledAt: '2026-06-01', lastActiveAt: '2026-07-21',
  },
  {
    id: 'p-006', name: '周某某', age: 60, gender: '女',
    conditions: ['高血压'],
    drugIds: ['mock-amlodipine-5'],
    records: [...buildRecords('mock-amlodipine-5', 30, 0.97, 0)],
    consultHistory: { count: 2, lastQuestion: '这个药怎么保存', riskLevel: 'L1', blockedCount: 0 },
    riskEvents: [],
    enrolledAt: '2026-06-20', lastActiveAt: '2026-07-21',
  },
  {
    id: 'p-007', name: '吴某某', age: 70, gender: '男',
    conditions: ['2型糖尿病', '高血脂'],
    drugIds: ['mock-metformin-500', 'mock-atorvastatin-20'],
    records: [
      ...buildRecords('mock-metformin-500', 30, 0.3, 7),
      ...buildRecords('mock-atorvastatin-20', 30, 0.35, 6),
    ],
    consultHistory: { count: 10, lastQuestion: '药吃完了能不能不吃', riskLevel: 'L3', blockedCount: 5 },
    riskEvents: [
      { date: '2026-07-19', level: 'L3', type: '拒答', detail: '询问停药，已引导联系医生' },
    ],
    enrolledAt: '2026-06-08', lastActiveAt: '2026-07-20',
  },
  {
    id: 'p-008', name: '郑某某', age: 63, gender: '女',
    conditions: ['高血压', '胃溃疡'],
    drugIds: ['mock-amlodipine-5', 'mock-omeprazole-20'],
    records: [
      ...buildRecords('mock-amlodipine-5', 30, 0.85, 1),
      ...buildRecords('mock-omeprazole-20', 30, 0.9, 0),
    ],
    consultHistory: { count: 4, lastQuestion: '奥美拉唑和降压药能一起吃吗', riskLevel: 'L1', blockedCount: 0 },
    riskEvents: [],
    enrolledAt: '2026-06-12', lastActiveAt: '2026-07-21',
  },
]

function findPatient(patientId) {
  return mockPatients.find((p) => p.id === patientId) || null
}

// 工具 1：依从性计算
function getAdherence(patient, dateRange = 30) {
  const records = patient.records.filter((r) => {
    const cutoff = recentDates(dateRange)[0]
    return r.date >= cutoff
  })
  const total = records.length
  const taken = records.filter((r) => r.status === 'taken').length
  const skipped = records.filter((r) => r.status === 'skipped').length
  const rate = total ? Math.round((taken / total) * 100) : 0

  // 连续漏服天数（从最近一天往前数）
  const sorted = [...records].sort((a, b) => (a.date < b.date ? 1 : -1))
  let consecutiveSkip = 0
  for (const r of sorted) {
    if (r.status === 'skipped') consecutiveSkip++
    else break
  }

  // 漏服明细（最近 5 条）
  const skipDetails = sorted
    .filter((r) => r.status === 'skipped')
    .slice(0, 5)
    .map((r) => ({ date: r.date, drugId: r.drugId }))

  return { rate, taken, skipped, total, consecutiveSkip, skipDetails, dateRange }
}

// 工具 2：用药清单
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

// 工具 3：相互作用检查
function checkInteractions(patient) {
  const ids = patient.drugIds
  const hits = interactionRules.filter((rule) => rule.drugs.every((id) => ids.includes(id)))
  return {
    hasInteraction: hits.length > 0,
    items: hits.map((h) => ({ level: h.level, note: h.note, drugs: h.drugs })),
  }
}

// 工具 4：临期 / 过期 / 低库存
function checkExpiryStock(patient) {
  const today = new Date('2026-07-21')
  const meds = getMedicationList(patient)
  const expiring = []
  const expired = []
  const lowStock = []
  for (const m of meds) {
    if (!m.expiry || m.expiry === '待录入') continue
    const exp = new Date(m.expiry)
    const days = Math.round((exp - today) / (1000 * 60 * 60 * 24))
    if (days < 0) expired.push({ ...m, days })
    else if (days <= 30) expiring.push({ ...m, days })
    if (m.stock <= 10) lowStock.push({ ...m })
  }
  return { expiring, expired, lowStock }
}

// 工具 5：风险事件 + 咨询热点
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

// 安全守门：对 LLM 生成的摘要做 L1~L4 校验
// 复用现有 emergencyPattern / prohibitedPattern / dosageOutputPattern
function guardSummary(sections) {
  const summary = sections.summary || ''
  const keyPoints = Array.isArray(sections.keyPoints) ? sections.keyPoints : []
  const nextAction = sections.nextAction || ''
  const combined = [summary, ...keyPoints, nextAction].join(' ')

  // L4：摘要本身命中紧急关键词（罕见，但守门兜底）
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
  // L3：摘要中出现越界用药调整建议
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
  // L2：摘要中残留具体剂量建议 -> 过滤
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
  // L1：正常
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

// 离线降级：无 BAICHUAN_API_KEY 时用规则拼接确定性摘要
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

function normalizeSections(raw, drug) {
  const profile = drugProfiles[drug.id] || {}
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
    summary: summary || profile.purpose || '暂时无法给出确定结论，请查看药品说明书或咨询医生、药师。',
    keyPoints: keyPoints.length ? keyPoints : profile.purpose ? [profile.purpose] : [],
    risks: risks.length ? risks : profile.risks || [],
    nextAction: limited ? '具体用量和疗程请按医生处方或说明书执行。' : nextAction,
    warning,
    limited,
  }
}

function fallbackSections(question, drug) {
  const profile = drugProfiles[drug.id] || {}
  if (/保存|储存/.test(question)) {
    return normalizeSections(
      {
        summary: profile.storage || '请按包装和说明书要求保存。',
        keyPoints: ['避免受潮和阳光直射', '放在儿童接触不到的地方'],
        risks: ['过期或储存不当可能影响药品质量'],
        nextAction: '请核对你手中包装的储存说明。',
        warning: '不要根据 AI 回答自行调整处方。',
      },
      drug,
    )
  }
  if (/不良|副作用|反应/.test(question)) {
    return normalizeSections(
      {
        summary: '如出现明显不适，应尽快咨询医生或药师。',
        keyPoints: profile.risks || ['不同人反应可能不同'],
        risks: ['出现严重皮疹、呼吸困难或持续严重腹泻时应立即就医'],
        nextAction: '记录不适出现时间和程度，就医时告知医生。',
        warning: '不要根据 AI 回答自行停药或改剂量。',
      },
      drug,
    )
  }
  return normalizeSections(
    {
      summary: profile.purpose || `${drug.genericName} 的详细说明请查看说明书或咨询医生、药师。`,
      keyPoints: ['本回答仅用于演示药品资料解释', '不代表对你的诊断或个体用药建议'],
      risks: profile.risks || ['对药物成分过敏者需提前告知医生'],
      nextAction: '按处方使用，不要自行调整。',
      warning: '不要根据 AI 回答自行调整处方。',
    },
    drug,
  )
}

function buildConsultResponse(rawAnswer, question, drug) {
  const parsed = safeJson(rawAnswer)
  const sections = parsed ? normalizeSections(parsed, drug) : fallbackSections(question, drug)
  const citations = [drugProfiles[drug.id]?.source || '本地 Mock 药品档案'].filter(Boolean)

  if (sections.limited) {
    return {
      riskLevel: 'L2',
      status: 'limited',
      answer: sections.summary,
      sections: {
        summary: sections.summary,
        keyPoints: sections.keyPoints,
        risks: sections.risks,
        nextAction: sections.nextAction,
        warning: sections.warning,
      },
      citations,
      notice: '已过滤具体剂量建议。用量请按医生处方或说明书执行。',
    }
  }

  return {
    riskLevel: 'L1',
    status: 'answered',
    answer: sections.summary,
    sections: {
      summary: sections.summary,
      keyPoints: sections.keyPoints,
      risks: sections.risks,
      nextAction: sections.nextAction,
      warning: sections.warning,
    },
    citations,
  }
}

function normalize(value) {
  return String(value || '').replace(/\s|×|x|\*/gi, '').toLowerCase()
}

function matchDrug(extracted) {
  const candidates = mockDrugs.filter((drug) => {
    const nameMatches =
      normalize(extracted.genericName).includes(normalize(drug.genericName)) ||
      normalize(drug.genericName).includes(normalize(extracted.genericName))
    const extractedDose = normalize(extracted.specification).match(/\d+(?:\.\d+)?(?:mg|g)/)?.[0]
    const drugDose = normalize(drug.specification).match(/\d+(?:\.\d+)?(?:mg|g)/)?.[0]
    const specificationMatches = Boolean(extractedDose && drugDose && extractedDose === drugDose)
    const formMatches =
      !extracted.form || normalize(drug.form).includes(normalize(extracted.form)) || normalize(extracted.form).includes('片')
    return nameMatches && specificationMatches && formMatches
  })
  return candidates.length === 1 ? candidates[0] : null
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

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    qwenConfigured: Boolean(process.env.QWEN_API_KEY),
    baichuanConfigured: Boolean(process.env.BAICHUAN_API_KEY),
  })
})

app.post('/api/ocr', async (request, response) => {
  const { image } = request.body || {}
  if (!process.env.QWEN_API_KEY) return response.status(503).json({ error: '服务端未配置 QWEN_API_KEY' })
  if (typeof image !== 'string' || !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(image)) {
    return response.status(400).json({ error: '请上传 JPG、PNG 或 WebP 药盒图片' })
  }
  if (image.length > 21 * 1024 * 1024) return response.status(413).json({ error: '图片过大，请压缩到 15MB 以内' })

  try {
    const content = await chatCompletion({
      baseUrl: cleanBaseUrl(process.env.QWEN_BASE_URL, 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
      apiKey: process.env.QWEN_API_KEY,
      model: process.env.QWEN_VL_MODEL || 'qwen3-vl-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: image } },
            {
              type: 'text',
              text: '识别这张药品完整包装或说明书。只输出严格 JSON，不要 Markdown：{"genericName":"","brandName":"","specification":"","form":"","manufacturer":"","approval":"","quality":"high|low","qualityReason":""}。无法确认的字段留空；不要根据散装药片外观猜测药名。',
            },
          ],
        },
      ],
    })
    const extracted = safeJson(content)
    if (!extracted) return response.status(422).json({ error: 'OCR 返回格式无法解析，请重试' })
    const required = extracted.genericName && extracted.specification && extracted.form
    const match = required && extracted.quality !== 'low' ? matchDrug(extracted) : null

    response.json({
      extracted,
      match,
      status: match ? 'matched' : 'unmatched',
      message: match
        ? '已在 Mock 药品库中找到唯一匹配，请核对包装'
        : '无法可靠唯一匹配，请勿据此服药。请补拍完整包装或咨询药师。',
      source: 'Qwen3-VL-Flash + 本地 Mock 药品库',
    })
  } catch (error) {
    console.error('OCR request failed:', error instanceof Error ? error.message : error)
    response.status(502).json({ error: `OCR 服务调用失败：${error instanceof Error ? error.message : '未知错误'}` })
  }
})

app.post('/api/consult', async (request, response) => {
  const question = String(request.body?.question || '').trim()
  const drug = request.body?.drug
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
  if (!process.env.BAICHUAN_API_KEY) return response.status(503).json({ error: '服务端未配置 BAICHUAN_API_KEY' })

  try {
    const rawAnswer = await chatCompletion({
      baseUrl: cleanBaseUrl(process.env.BAICHUAN_BASE_URL, 'https://api.baichuan-ai.com/v1'),
      apiKey: process.env.BAICHUAN_API_KEY,
      model: process.env.BAICHUAN_MODEL || 'Baichuan-M3-Plus',
      messages: [
        {
          role: 'user',
          content: `你是“安心用药”演示版药品资料解释助手。只围绕已确认药品回答用户问题。

硬性规则：
1. 只输出严格 JSON，禁止 Markdown、禁止 **粗体**、禁止 ^[1]^ 这类引用编号。
2. 总字数控制在 150-250 个汉字。
3. 不得给出具体剂量、频次、疗程数字，不得说“一日X片/每次X mg”。
4. 不得诊断、开处方、建议停换药。
5. 不要罗列与用户问题无关的全部适应症、病原体、罕见不良反应。
6. 不要结尾追问“是否需要我继续检索”。

JSON 格式：
{"summary":"一句话直接回答","keyPoints":["最多3条"],"risks":["最多3条"],"nextAction":"下一步建议","warning":"不要自行调整处方的提示"}

已确认药品：${drug.genericName}；规格：${drug.specification || '未提供'}；剂型：${drug.form || '未提供'}。
用户问题：${question}`,
        },
      ],
    })
    response.json(buildConsultResponse(rawAnswer, question, drug))
  } catch (error) {
    console.error('Consult request failed:', error instanceof Error ? error.message : error)
    response.status(502).json({ error: `百川服务调用失败：${error instanceof Error ? error.message : '未知错误'}` })
  }
})

// ---------------------------------------------------------------------------
// 患者洞察 Agent · API 路由
// 编排流程：串行调用只读工具 -> 组装上下文 -> 调百川生成摘要 -> 安全守门 -> 输出
// ---------------------------------------------------------------------------

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

  const toolChain = [
    'getAdherence',
    'getMedicationList',
    'checkInteractions',
    'checkExpiryStock',
    'getRiskEvents',
  ]

  // 1. 串行调用只读工具，收集结构化输出
  const adherence = getAdherence(patient, 30)
  const medicationList = getMedicationList(patient)
  const interactions = checkInteractions(patient)
  const expiry = checkExpiryStock(patient)
  const riskEvents = getRiskEvents(patient)
  const tools = { adherence, medicationList, interactions, expiry, riskEvents }

  const dateRange = `${recentDates(30)[0]} ~ ${recentDates(30)[29]}`
  const generatedAt = new Date().toISOString()

  // 2. 离线降级：未配置百川 Key 时用规则拼接确定性摘要
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

  // 3. 调百川 LLM 组装诊前摘要
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
    // 4. 安全守门：L1~L4 校验
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
    // LLM 失败时降级为规则摘要，保证可用
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
})
