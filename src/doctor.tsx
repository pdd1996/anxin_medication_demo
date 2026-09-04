// 患者洞察 Agent · 医生端视图（对应 docs/04 阶段 B，沿用 V1）
// 单编排 Agent + 多只读工具 + 安全守门，详见 server/index.js /api/insight
import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Info,
  LoaderCircle,
  PackageCheck,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react'

interface PatientListItem {
  id: string
  name: string
  age: number
  gender: string
  conditions: string[]
  drugCount: number
  enrolledAt: string
  lastActiveAt: string
}

interface InsightMedication {
  id: string
  genericName: string
  brandName: string
  specification: string
  form: string
  stock: number
  expiry: string
}

interface InsightSummary {
  patient: PatientListItem & { conditions: string[] }
  riskLevel: 'L1' | 'L2' | 'L3' | 'L4'
  sections: {
    summary: string
    keyPoints: string[]
    risks: string[]
    nextAction: string
    warning: string
  }
  tools: {
    adherence: { rate: number; taken: number; total: number; skipped: number; consecutiveSkip: number; skipDetails: { date: string; drugId: string }[]; dateRange: number }
    medicationList: InsightMedication[]
    interactions: { hasInteraction: boolean; items: { level: string; note: string; drugs: string[] }[] }
    expiry: { expiring: (InsightMedication & { days: number })[]; expired: (InsightMedication & { days: number })[]; lowStock: InsightMedication[] }
    riskEvents: { events: { date: string; level: string; type: string; detail: string }[]; consultCount: number; lastQuestion: string; blockedCount: number; hasL4: boolean; hasL3: boolean }
  }
  snapshot: { generatedAt: string; dateRange: string; toolChain: string[]; mode: string }
  citations: string[]
  notice?: string
}

export function InsightPage() {
  const [patients, setPatients] = useState<PatientListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [summary, setSummary] = useState<InsightSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (selectedId) return
    let cancelled = false
    setLoading(true)
    fetch('/api/insight/patients')
      .then((res) => res.json())
      .then((payload) => {
        if (cancelled) return
        setPatients(payload.patients || [])
        setError('')
      })
      .catch(() => {
        if (!cancelled) setError('患者列表加载失败，请确认后端服务已启动')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  async function loadSummary(patientId: string) {
    setSelectedId(patientId)
    setSummary(null)
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/insight/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId }),
      })
      const payload = (await res.json()) as InsightSummary & { error?: string }
      if (!res.ok || payload.error) throw new Error(payload.error || '摘要生成失败')
      setSummary(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : '摘要生成失败')
    } finally {
      setLoading(false)
    }
  }

  if (selectedId && summary) {
    return <PatientSummaryView summary={summary} onBack={() => { setSelectedId(null); setSummary(null) }} />
  }
  if (selectedId && loading) {
    return <PatientSummarySkeleton patient={patients.find((p) => p.id === selectedId)} onBack={() => setSelectedId(null)} />
  }
  return <PatientListView patients={patients} loading={loading} error={error} onPick={loadSummary} />
}

function PatientListView({ patients, loading, error, onPick }: {
  patients: PatientListItem[]
  loading: boolean
  error: string
  onPick: (id: string) => void
}) {
  return (
    <section className="insight-layout">
      <div className="section-heading">
        <div><span className="eyebrow">医生端 · 演示</span><h2>患者洞察</h2></div>
        <span className="status-chip">{patients.length} 名患者</span>
      </div>
      <div className="notice-card"><Info size={18} /><p>选择患者生成诊前摘要。Agent 调用依从性、相互作用、临期库存、风险事件等只读工具，再由 LLM 组装摘要并过安全守门。本页仅供演示，不用于真实诊疗。</p></div>
      {loading && <div className="empty-journey"><LoaderCircle size={28} className="spin" /><p>正在加载患者列表…</p></div>}
      {error && <div className="empty-journey"><AlertTriangle size={28} /><p>{error}</p></div>}
      {!loading && !error && patients.length === 0 && (
        <div className="empty-journey"><Stethoscope size={28} /><p>暂无患者数据</p></div>
      )}
      <div className="patient-grid">
        {patients.map((p) => (
          <button key={p.id} className="patient-card" onClick={() => onPick(p.id)}>
            <div className="patient-head">
              <div className="patient-avatar">{p.name.charAt(0)}</div>
              <div className="patient-info">
                <strong>{p.name}</strong>
                <span>{p.age} 岁 · {p.gender}</span>
              </div>
              <ChevronRight size={18} />
            </div>
            <div className="patient-tags">
              {p.conditions.map((c) => <span key={c} className="chip">{c}</span>)}
              <span className="chip muted">{p.drugCount} 种药</span>
            </div>
            <p className="patient-meta">最近活跃 {p.lastActiveAt}</p>
          </button>
        ))}
      </div>
    </section>
  )
}

function PatientSummarySkeleton({ patient, onBack }: { patient?: PatientListItem; onBack: () => void }) {
  return (
    <section className="insight-layout">
      <button className="back-btn secondary" onClick={onBack}><ChevronRight size={16} className="flip" />返回患者列表</button>
      <div className="empty-journey"><LoaderCircle size={28} className="spin" /><p>正在为 {patient?.name || '患者'} 生成诊前摘要…</p><p className="muted">Agent 正在调用只读工具并组装摘要</p></div>
    </section>
  )
}

function PatientSummaryView({ summary, onBack }: { summary: InsightSummary; onBack: () => void }) {
  const { patient, sections, tools, snapshot, riskLevel, citations, notice } = summary
  const adherence = tools.adherence
  return (
    <section className="insight-layout">
      <button className="back-btn secondary" onClick={onBack}><ChevronRight size={16} className="flip" />返回患者列表</button>

      <div className="profile-card insight-head">
        <div className="profile-avatar">{patient.name.charAt(0)}</div>
        <div>
          <h2>{patient.name}</h2>
          <p>{patient.age} 岁 · {patient.gender} · {patient.conditions.join('、')}</p>
        </div>
        <span className={`risk-tag ${riskLevel.toLowerCase()}`}>{riskLevel}</span>
      </div>

      {notice && <div className="notice-card"><AlertTriangle size={18} /><p>{notice}</p></div>}

      <div className="section-heading compact">
        <div><span className="eyebrow">工具输出</span><h2>依从性</h2></div>
      </div>
      <div className="insight-adherence">
        <div className="adherence-bar">
          <div className="adherence-fill" style={{ width: `${adherence.rate}%` }} data-rate={adherence.rate >= 60 ? 'ok' : 'warn'} />
        </div>
        <div className="adherence-stats">
          <span>执行率 <strong>{adherence.rate}%</strong></span>
          <span>已服 <strong>{adherence.taken}</strong>/{adherence.total}</span>
          <span>漏服 <strong>{adherence.skipped}</strong></span>
          {adherence.consecutiveSkip > 0 && <span className="warn-text">连续漏服 <strong>{adherence.consecutiveSkip}</strong> 次</span>}
        </div>
        {adherence.consecutiveSkip > 0 && (
          <div className="safety-box"><AlertTriangle size={18} /><div><strong>连续漏服警示</strong><p>近 {adherence.skipDetails.length} 次漏服：{adherence.skipDetails.map((s) => s.date).join('、')}。建议诊间询问漏服原因。</p></div></div>
        )}
      </div>

      <div className="section-heading compact">
        <div><span className="eyebrow">工具输出</span><h2>用药清单与相互作用</h2></div>
      </div>
      <div className="cabinet-list">
        {tools.medicationList.map((m) => (
          <div key={m.id} className="drug-card insight-drug">
            <div className="drug-content">
              <strong>{m.genericName}</strong>
              <dl>
                <div><dt>规格</dt><dd>{m.specification}</dd></div>
                <div><dt>库存</dt><dd>{m.stock}</dd></div>
                <div><dt>效期</dt><dd>{m.expiry}</dd></div>
              </dl>
            </div>
          </div>
        ))}
      </div>
      {tools.interactions.hasInteraction ? (
        <div className="safety-box warn"><AlertTriangle size={18} /><div><strong>相互作用提示</strong>{tools.interactions.items.map((i, idx) => <p key={idx}>{i.level}：{i.note}</p>)}</div></div>
      ) : (
        <div className="notice-card"><ShieldCheck size={18} /><p>未见明确药物相互作用。</p></div>
      )}
      {tools.expiry.expiring.length > 0 && (
        <div className="safety-box warn"><AlertTriangle size={18} /><div><strong>临期药品</strong>{tools.expiry.expiring.map((m) => <p key={m.id}>{m.genericName} · {m.expiry} 到期（剩 {m.days} 天）</p>)}</div></div>
      )}
      {tools.expiry.lowStock.length > 0 && (
        <div className="notice-card"><PackageCheck size={18} /><p>低库存：{tools.expiry.lowStock.map((m) => m.genericName).join('、')}</p></div>
      )}

      <div className="section-heading compact">
        <div><span className="eyebrow">工具输出</span><h2>风险事件与咨询</h2></div>
      </div>
      {tools.riskEvents.events.length > 0 ? (
        <div className="risk-event-list">
          {tools.riskEvents.events.map((e, idx) => (
            <div key={idx} className="risk-event-row">
              <span className={`risk-tag ${e.level.toLowerCase()}`}>{e.level}</span>
              <div><strong>{e.type}</strong><p>{e.date} · {e.detail}</p></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="notice-card"><ShieldCheck size={18} /><p>近 30 天无 L3/L4 风险事件。</p></div>
      )}
      <div className="notice-card"><Info size={18} /><p>累计咨询 {tools.riskEvents.consultCount} 次，被安全规则拦截 {tools.riskEvents.blockedCount} 次。最近提问："{tools.riskEvents.lastQuestion}"</p></div>

      <div className="section-heading compact">
        <div><span className="eyebrow">Agent 摘要</span><h2>诊前摘要</h2></div>
        <span className="status-chip">{snapshot.mode === 'llm' ? 'LLM 生成' : '规则降级'}</span>
      </div>
      <div className="answer-structured insight-summary">
        <div className="answer-summary"><span>简明结论</span><strong>{sections.summary}</strong></div>
        {sections.keyPoints.length > 0 && (
          <div className="answer-section"><h4><Info size={16} />关键发现</h4><ul>{sections.keyPoints.map((k) => <li key={k}>{k}</li>)}</ul></div>
        )}
        {sections.risks.length > 0 && (
          <div className="answer-section risk"><h4><AlertTriangle size={16} />风险提示</h4><ul>{sections.risks.map((r) => <li key={r}>{r}</li>)}</ul></div>
        )}
        <div className="next-action"><ChevronRight size={17} /><div><span>下一步</span><strong>{sections.nextAction}</strong></div></div>
        <p className="answer-warning"><ShieldCheck size={15} />{sections.warning}</p>
      </div>

      <div className="tool-snapshot">
        <strong>数据快照</strong>
        <p>生成时间：{snapshot.generatedAt}</p>
        <p>数据区间：{snapshot.dateRange}</p>
        <p>工具链：{snapshot.toolChain.join(' -> ')}</p>
        <p>来源：{citations.join('；')}</p>
      </div>
      <div className="disclaimer"><AlertTriangle size={21} /><div><strong>仅供参考</strong><p>本摘要基于患者自报数据与 Mock 演示数据，由 Agent 调用只读工具并经安全守门生成，不构成诊疗或用药调整依据。请向患者核实后依处方判断。</p></div></div>
    </section>
  )
}
