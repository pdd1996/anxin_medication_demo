import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Box,
  CalendarClock,
  CircleSlash2,
  FileText,
  Hand,
  Pause,
  Pencil,
  Pill,
  Play,
  Plus,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import type { Drug, Plan, SourceRecord } from '../types'
import { CONFIRM_STATUS_META, DOSE_UNITS, TAG_META, estimateStockDays, suggestTimes } from '../lib'

function planStatusChip(plan?: Plan): { label: string; className: string } {
  if (!plan) return { label: '未创建计划', className: 'plan-chip none' }
  if (plan.status === 'paused') return { label: '已暂停', className: 'plan-chip paused' }
  if (plan.status === 'ended') return { label: '已结束', className: 'plan-chip ended' }
  if (plan.cycleType === 'open') return { label: '生效中 · 开放式（长期）', className: 'plan-chip active' }
  if (plan.cycleType === 'stock') return { label: '生效中 · 用完为止', className: 'plan-chip active' }
  return { label: `生效中 · 疗程至 ${plan.endDate}`, className: 'plan-chip active' }
}

export function CabinetPage({
  drugs,
  plans,
  sources,
  onEntry,
  onManual,
  onPlan,
  onTogglePause,
  onEndPlan,
  onDelete,
}: {
  drugs: Drug[]
  plans: Plan[]
  sources: SourceRecord[]
  onEntry: () => void
  onManual: () => void
  onPlan: (drugId: string, plan?: Plan) => void
  onTogglePause: (plan: Plan) => void
  onEndPlan: (plan: Plan) => void
  onDelete: (drugId: string) => void
}) {
  return (
    <section>
      <div className="section-heading">
        <div>
          <span className="eyebrow">MY MEDICINE CABINET</span>
          <h2>我的药箱</h2>
          <p>把一个人所有来源的药放进同一个药箱——管依从、管冲突、管效期。</p>
        </div>
        <div className="heading-actions">
          <button className="secondary" onClick={onManual}><Hand size={17} />手动建档</button>
          <button className="primary" onClick={onEntry}><Plus size={18} />拍照录入</button>
        </div>
      </div>

      {drugs.length === 0 ? (
        <div className="empty-journey">
          <div className="journey-icon"><Box size={34} /></div>
          <h3>药箱还是空的</h3>
          <p>拍一张处方笺或药盒照片，识别并确认后加入药箱；也可手动建档。</p>
          <button className="primary" onClick={onEntry}>开始录入</button>
        </div>
      ) : (
        <div className="drug-grid">
          {drugs.map((drug) => {
            const plan = plans.find((p) => p.drugId === drug.id)
            const source = sources.find((s) => s.id === drug.sourceId)
            const statusMeta = CONFIRM_STATUS_META[drug.confirmStatus]
            const chip = planStatusChip(plan)
            const stockDays = plan ? estimateStockDays(drug.stock, plan.dose.value, plan.frequency) : 0
            const openedOverdue =
              drug.openedAt && drug.expiry
                ? new Date(drug.openedAt).getTime() + 180 * 86_400_000 < Date.now()
                : false
            return (
              <article className="drug-card" key={drug.id}>
                <div className="drug-cover"><Pill size={42} /><span>{drug.confirmStatus === 'manual' ? 'MANUAL' : 'MOCK'}</span></div>
                <div className="drug-content">
                  <div className={`confirm-badge cs-${drug.confirmStatus}`} title={statusMeta.hint}>
                    <ShieldCheck size={14} />{statusMeta.label}
                  </div>
                  <h3>{drug.genericName}</h3>
                  <p>{drug.brandName}</p>
                  <dl>
                    <div><dt>规格</dt><dd>{drug.specification}</dd></div>
                    <div><dt>库存</dt><dd>{drug.stock} {drug.stockUnit}{plan && stockDays > 0 ? `（约 ${stockDays} 天）` : ''}</dd></div>
                    <div><dt>有效期</dt><dd>{drug.expiry || '待录入'}</dd></div>
                    {drug.openedAt && <div><dt>开封</dt><dd>{drug.openedAt}{openedOverdue ? ' · 已超开封效期' : ''}</dd></div>}
                  </dl>
                  {source && (
                    <p className="source-line">
                      <FileText size={13} />
                      来源：{source.kind}{source.hospital ? ` · ${source.hospital}` : ''}{source.date ? ` · ${source.date}` : ''} · {source.confirmMethod}
                    </p>
                  )}
                  <div className={`${chip.className} plan-chip-row`}>
                    {chip.label}
                    {plan && plan.tags.dose && (
                      <span className={`tag-badge tag-mini tag-${plan.tags.dose}`}>{TAG_META[plan.tags.dose].label}用量</span>
                    )}
                  </div>
                  {plan && (
                    <p className="plan-detail">
                      每次 {plan.dose.value} {plan.dose.unit} · 每日 {plan.frequency} 次 · {plan.times.join(' / ')}
                    </p>
                  )}
                  {openedOverdue && (
                    <div className="safety-box warn slim"><AlertTriangle size={15} /><p>开封已超说明书效期，建议弃药（以说明书为准）。</p></div>
                  )}
                  <div className="card-actions">
                    <button className="secondary" onClick={() => onPlan(drug.id, plan)}>
                      <Pencil size={14} />{plan ? '编辑计划' : '创建计划'}
                    </button>
                    {plan && plan.status === 'active' && (
                      <button className="icon-action" title="暂停计划" onClick={() => onTogglePause(plan)}><Pause size={17} /></button>
                    )}
                    {plan && plan.status === 'paused' && (
                      <button className="icon-action" title="恢复计划" onClick={() => onTogglePause(plan)}><Play size={17} /></button>
                    )}
                    {plan && plan.status !== 'ended' && (
                      <button className="icon-action" title="结束计划" onClick={() => onEndPlan(plan)}><Square size={15} /></button>
                    )}
                    {plan && plan.status === 'ended' && (
                      <span className="icon-action ended"><CircleSlash2 size={16} /></span>
                    )}
                    <button className="danger-icon" aria-label="删除药品" onClick={() => onDelete(drug.id)}><Trash2 size={18} /></button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

// 手动填表式建计划（入口B 自购药盒、编辑场景）——沿用 V1 流程并接入周期形态
export function PlanModal({
  drug,
  plan,
  onClose,
  onSave,
}: {
  drug: Drug
  plan?: Plan
  onClose: () => void
  onSave: (data: {
    dose: { value: number; unit: string }
    frequency: number
    times: string[]
    meal: string
    cycleType: 'closed' | 'open' | 'stock'
    endDate?: string
  }) => void
}) {
  const [doseValue, setDoseValue] = useState(String(plan?.dose.value ?? 1))
  const [doseUnit, setDoseUnit] = useState(plan?.dose.unit ?? drug.stockUnit ?? '片')
  const [frequency, setFrequency] = useState(String(plan?.frequency ?? 3))
  const [times, setTimes] = useState<string[]>(plan?.times ?? suggestTimes(3))
  const [meal, setMeal] = useState(plan?.meal ?? '无特殊要求')
  const [cycleChoice, setCycleChoice] = useState<'longterm' | 'until-used' | 'custom'>(
    plan ? (plan.cycleType === 'open' ? 'longterm' : plan.cycleType === 'stock' ? 'until-used' : 'custom') : 'longterm',
  )
  const [customDays, setCustomDays] = useState('7')
  const [agreed, setAgreed] = useState(false)

  useEffect(() => {
    setTimes(suggestTimes(Number(frequency) || 1))
  }, [frequency])

  const valid = Number(doseValue) > 0 && Number(frequency) > 0 && times.length > 0 && agreed &&
    (cycleChoice !== 'custom' || Number(customDays) > 0)

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <button className="modal-close" onClick={onClose}><X size={21} /></button>
        <span className="eyebrow">{plan ? 'EDIT' : 'NEW'} MEDICATION PLAN</span>
        <h2>{plan ? '编辑服药计划' : '创建服药计划'}</h2>
        <p className="modal-subtitle">请严格按照医生处方、说明书或药师指导填写——系统不会替你生成用量。</p>
        <div className="selected-drug">
          <span><Pill size={22} /></span>
          <div><strong>{drug.genericName}</strong><small>{drug.specification} · {drug.form}</small></div>
        </div>
        <div className="form-grid">
          <label>每次用量
            <div className="input-suffix">
              <input type="number" min="0.5" step="0.5" value={doseValue} onChange={(event) => setDoseValue(event.target.value)} />
              <select className="unit-select" value={doseUnit} onChange={(event) => setDoseUnit(event.target.value)}>
                {DOSE_UNITS.map((unit) => <option key={unit}>{unit}</option>)}
              </select>
            </div>
          </label>
          <label>频次（每日次数）<input type="number" min="1" max="8" value={frequency} onChange={(event) => setFrequency(event.target.value)} /></label>
          <label className="full">服药要求
            <select value={meal} onChange={(event) => setMeal(event.target.value)}>
              <option>无特殊要求</option><option>饭前</option><option>饭后</option><option>随餐</option><option>睡前</option>
            </select>
          </label>
        </div>
        <div className="time-editor modal-time-editor">
          {times.map((time, idx) => (
            <div key={idx} className="time-chip">
              <input type="time" value={time} onChange={(event) => setTimes((current) => current.map((t, i) => (i === idx ? event.target.value : t)))} />
              <button aria-label="删除时间点" onClick={() => setTimes((current) => current.filter((_, i) => i !== idx))}><X size={13} /></button>
            </div>
          ))}
          <button className="time-add" onClick={() => setTimes((current) => [...current, '08:00'])}><Plus size={13} />添加</button>
          <span className="tag-badge tag-assist">辅助</span>
        </div>
        <div className="cycle-choice modal-cycle">
          <label className={cycleChoice === 'longterm' ? 'selected' : ''}>
            <input type="radio" name="modal-cycle" checked={cycleChoice === 'longterm'} onChange={() => setCycleChoice('longterm')} />
            <div><strong>长期服用</strong><span>开放式 · 无结束日期</span></div>
          </label>
          <label className={cycleChoice === 'until-used' ? 'selected' : ''}>
            <input type="radio" name="modal-cycle" checked={cycleChoice === 'until-used'} onChange={() => setCycleChoice('until-used')} />
            <div><strong>用完为止</strong><span>按库存推算可用天数</span></div>
          </label>
          <label className={cycleChoice === 'custom' ? 'selected' : ''}>
            <input type="radio" name="modal-cycle" checked={cycleChoice === 'custom'} onChange={() => setCycleChoice('custom')} />
            <div><strong>自定义天数</strong>
              <span className="custom-days"><input type="number" min="1" value={customDays} onChange={(event) => setCustomDays(event.target.value)} onClick={() => setCycleChoice('custom')} /> 天</span>
            </div>
          </label>
        </div>
        <label className="check-line">
          <input type="checkbox" checked={agreed} onChange={() => setAgreed(!agreed)} />
          此用量来自处方、说明书或药师指导
        </label>
        <button
          className="primary full-button"
          disabled={!valid}
          onClick={() =>
            onSave({
              dose: { value: Number(doseValue), unit: doseUnit },
              frequency: Number(frequency),
              times,
              meal,
              cycleType: cycleChoice === 'longterm' ? 'open' : cycleChoice === 'until-used' ? 'stock' : 'closed',
              endDate:
                cycleChoice === 'custom'
                  ? new Date(Date.now() + Number(customDays) * 86_400_000).toISOString().slice(0, 10)
                  : undefined,
            })
          }
        >
          <CalendarClock size={17} />{plan ? '保存计划' : '确认创建计划'}
        </button>
      </div>
    </div>
  )
}

// 手动建档（不经识别）——标注「未经 OCR 确认」，不进入 AI 个性化用药建议（L1+），仅可做 L0 资料查询
export function ManualDrugModal({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (data: { genericName: string; specification: string; form: string; stock: number; stockUnit: string }) => void
}) {
  const [form, setForm] = useState({ genericName: '', specification: '', form: '', stock: '1', stockUnit: '支' })
  const valid = form.genericName.trim() && form.specification.trim() && form.form.trim()
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <button className="modal-close" onClick={onClose}><X size={21} /></button>
        <span className="eyebrow">MANUAL ENTRY</span>
        <h2>手动建档</h2>
        <p className="modal-subtitle">识别失败时的兜底路径：直接填写药名/规格/剂型。该药品将标注「未经 OCR 确认」，AI 个性化咨询不可用，仅可做 L0 资料查询。</p>
        <div className="form-grid">
          <label>药名<input value={form.genericName} onChange={(event) => setForm({ ...form, genericName: event.target.value })} placeholder="如：玻璃酸钠滴眼液" /></label>
          <label>剂型<input value={form.form} onChange={(event) => setForm({ ...form, form: event.target.value })} placeholder="如：滴眼液" /></label>
          <label>规格<input value={form.specification} onChange={(event) => setForm({ ...form, specification: event.target.value })} placeholder="如：0.1%（10mL：10mg）" /></label>
          <label>库存
            <div className="input-suffix">
              <input type="number" min="0" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} />
              <select className="unit-select" value={form.stockUnit} onChange={(event) => setForm({ ...form, stockUnit: event.target.value })}>
                {DOSE_UNITS.map((unit) => <option key={unit}>{unit}</option>)}
              </select>
            </div>
          </label>
        </div>
        <button
          className="primary full-button"
          disabled={!valid}
          onClick={() => onSave({ ...form, stock: Number(form.stock) || 0 })}
        >
          <ShieldCheck size={17} />确认手动建档
        </button>
      </div>
    </div>
  )
}
