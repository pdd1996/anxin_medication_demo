import type { ConfirmStatus, CycleType, TagKind } from './types'

// 四类标注元数据（PRD V2 §7.2.4）
export const TAG_META: Record<TagKind, { label: string; hint: string }> = {
  transcribed: { label: '抄录', hint: '来自处方/标签原文' },
  assist: { label: '辅助', hint: '系统建议，非医嘱，可调整' },
  derived: { label: '推算', hint: '由已确认信息计算' },
  default: { label: '默认', hint: '系统推断的初始值，可修改' },
  user: { label: '自填', hint: '用户人工补录/修正' },
}

// 药品确认状态三档（PRD V2 §7.5）
export const CONFIRM_STATUS_META: Record<ConfirmStatus, { label: string; hint: string }> = {
  prescription: { label: '处方抄录确认', hint: '用量频次来自处方笺/医院标签原文，经用户逐项核对' },
  'ocr-unique': { label: 'OCR 唯一匹配确认', hint: '药品身份库唯一匹配，经用户核对包装' },
  manual: { label: '手动建档 · 未经 OCR 确认', hint: 'AI 个性化咨询不可用，仅 L0 资料查询' },
}

export const CYCLE_META: Record<CycleType, { label: string; hint: string }> = {
  closed: { label: '封闭式', hint: '有疗程，结束日期自动推算' },
  open: { label: '开放式', hint: '长期服用，无结束日期' },
  stock: { label: '用完为止', hint: '按库存推算预计可用天数' },
}

export const DOSE_UNITS = ['滴', '片', '粒', '支', '袋', '喷', '丸']

export function loadState<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    return stored ? (JSON.parse(stored) as T) : fallback
  } catch {
    return fallback
  }
}

export function todayStr(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(from)
  const b = new Date(to)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

// 库存按次扣减下的预计可用天数（推算标注）
export function estimateStockDays(stock: number, doseValue: number, frequency: number): number {
  const perDay = (doseValue || 0) * (frequency || 0)
  if (perDay <= 0) return 0
  return Math.floor(stock / perDay)
}

// 按频次在 8:00–22:00 均匀分布生成建议时间（每日 4 次 → 8/12/16/20）
export function suggestTimes(frequency: number): string[] {
  const n = Math.max(1, Math.min(8, Math.floor(Number(frequency) || 1)))
  if (n === 1) return ['08:00']
  return Array.from({ length: n }, (_, i) => `${String(8 + Math.round((12 * i) / (n - 1))).padStart(2, '0')}:00`)
}

export function isPlanActiveOn(plan: { status: string; startDate: string; endDate?: string }, date: string): boolean {
  return plan.status === 'active' && plan.startDate <= date && (!plan.endDate || plan.endDate >= date)
}
