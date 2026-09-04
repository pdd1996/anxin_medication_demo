// 安心用药 Demo · 类型定义（对齐 PRD V2 数据模型 §12.3）
// 药品主数据库 ≠ 用户药箱：drugs 为确认后拷贝的个人档案，带确认状态三档

export type Tab = 'today' | 'cabinet' | 'entry' | 'consult' | 'profile'
export type TaskStatus = 'pending' | 'taken' | 'skipped' | 'later'

// 药品确认状态三档（PRD V2 §7.5）
export type ConfirmStatus = 'prescription' | 'ocr-unique' | 'manual'

// 四类标注（PRD V2 §7.2.4）：抄录/辅助/推算/默认 + 用户自填（人工补录）
export type TagKind = 'transcribed' | 'assist' | 'derived' | 'default' | 'user'

// 计划周期形态（PRD V2 §7.3.2）：closed 封闭式（有疗程）/ open 开放式（长期）/ stock 用完为止
export type CycleType = 'closed' | 'open' | 'stock'

export interface Drug {
  id: string
  genericName: string
  brandName: string
  specification: string
  form: string
  manufacturer: string
  approval: string
  stock: number
  stockUnit: string
  expiry?: string
  openedAt?: string
  confirmStatus: ConfirmStatus
  sourceId?: string
  confirmedAt: string
}

export interface Plan {
  id: string
  drugId: string
  dose: { value: number; unit: string }
  frequency: number
  times: string[]
  meal?: string
  route?: string
  cycleType: CycleType
  startDate: string
  endDate?: string
  status: 'active' | 'paused' | 'ended'
  source: 'prescription' | 'label' | 'manual'
  sourceId?: string
  tags: Partial<Record<'dose' | 'frequency' | 'duration' | 'times' | 'startDate' | 'endDate', TagKind>>
  createdAt: string
}

export interface MedRecord {
  id: string
  planId: string
  date: string
  time: string
  status: 'taken' | 'skipped' | 'later'
  updatedAt: string
}

// 健康信息：字段级来源标注（用户自述 / 处方笺抄录 · 已确认）
export interface HealthEntry {
  id: string
  field: string
  value: string
  source: 'user' | 'prescription'
  confirmedAt?: string
}

// 来源表：档案和计划从哪来（三层追溯锚点）
export interface SourceRecord {
  id: string
  kind: string
  hospital?: string
  rxNo?: string
  date?: string
  confirmMethod: string
  confirmedAt: string
  keySnapshot: Record<string, string>
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  urgent?: boolean
  loading?: boolean
  status?: string
  notice?: string
  l0Notice?: string
  sections?: {
    summary: string
    keyPoints: string[]
    risks: string[]
    nextAction: string
    warning: string
  }
  citations?: string[]
}

// ---------------------------------------------------------------------------
// /api/extract 响应（草稿）
// ---------------------------------------------------------------------------

export interface CandidateDrug {
  id: string
  genericName: string
  brandName: string
  specification: string
  form: string
  manufacturer: string
  approval: string
  stock: number
  stockUnit: string
  packageStock?: number
  expiry?: string
  otcClass?: string
}

export interface DraftConflict {
  type: 'spec' | 'multi' | 'layer'
  note: string
  candidates?: CandidateDrug[]
}

export interface DraftPlan {
  dose: { value: number; unit: string } | null
  frequency: number | null
  route: string | null
  durationDays: number | null
  sigMissing: string[]
  times: string[]
  startDate: string
  endDate: string | null
  cycleType: 'closed' | 'pending'
  tags: Record<string, TagKind | null>
  sourceKind: 'prescription' | 'label'
}

export interface DraftItem {
  identity: {
    genericName: string
    brandName?: string
    specification?: string
    form?: string
    manufacturer?: string
    otcMark?: string
  }
  whitelistItem: { name: string; spec: string; quantity: string; sigText: string; raw: string }
  matchStatus: 'unique' | 'conflict' | 'unmatched'
  matchedDrug: CandidateDrug | null
  resolutionNote?: string
  conflicts: DraftConflict[]
  plan: DraftPlan | null
  otcNote?: string | null
  healthSuggestions: { field: string; value: string; source: string }[]
  rangeCheck: { status: 'pass' | 'exceed' | 'none'; issues: string[]; basis?: string; note?: string }
  interactions: { has: boolean; items: { level: string; note: string; source: string }[] }
}

export interface ExtractResponse {
  ok: boolean
  error?: string
  mode?: 'demo' | 'vlm'
  entry: 'A' | 'B'
  layers?: string[]
  layerWarning?: string | null
  quality?: { level: string; reason?: string }
  sanitized?: { type: string; count: number }[]
  prescription?: { hospital: string; rxNo: string; date: string; department: string; diagnosis: string } | null
  patientHint?: { gender?: string; age?: number } | null
  items?: DraftItem[]
  rawText?: string | null
  message?: string
  source?: string
  unsupported?: boolean
}

// 确认页提交给 App 的解析结果（confirmStatus 由 App 按 confirmMethod 归档时写入）
export interface ResolvedDraft {
  drug: Omit<Drug, 'confirmedAt' | 'confirmStatus'>
  confirmStatus: ConfirmStatus
  plan: Omit<Plan, 'id' | 'createdAt' | 'status'> | null
  health: { field: string; value: string }[]
  sourceMeta: {
    kind: string
    hospital?: string
    rxNo?: string
    date?: string
    confirmMethod: string
    keySnapshot: Record<string, string>
  }
  interactions: { has: boolean; items: { level: string; note: string; source: string }[] }
}
