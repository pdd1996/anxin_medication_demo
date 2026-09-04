import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileText,
  Info,
  ListChecks,
  Lock,
  Package,
  Pill,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import type { CandidateDrug, DraftItem, ExtractResponse, ResolvedDraft, TagKind } from '../types'
import { DOSE_UNITS, TAG_META, addDaysStr, estimateStockDays, suggestTimes } from '../lib'

export function ConfirmPage({
  payload,
  imageUrl,
  entry,
  activeDrugIds,
  profileGender,
  onConfirm,
  onDone,
  onMismatch,
}: {
  payload: ExtractResponse
  imageUrl: string
  entry: 'A' | 'B'
  activeDrugIds: string[]
  profileGender?: string
  onConfirm: (resolved: ResolvedDraft) => void
  onDone: () => void
  onMismatch: (action: 'retake' | 'manual') => void
}) {
  const items = payload.items || []
  const [index, setIndex] = useState(0)
  const item = items[index]
  if (!item) return null

  return (
    <section className="confirm-layout">
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">DRAFT CONFIRMATION · 唯一闸门</span>
          <h2>草稿确认{items.length > 1 ? `（第 ${index + 1}/${items.length} 份）` : ''}</h2>
          <p>凡进档案，最后一道门是你——用量、频次、疗程三个关键字段无差别逐项核对。</p>
        </div>
        <span className="status-chip"><ListChecks size={14} />{payload.mode === 'demo' ? '演示样例' : 'VLM 识别'}</span>
      </div>

      <ConfirmItem
        key={index}
        item={item}
        payload={payload}
        imageUrl={imageUrl}
        entry={entry}
        activeDrugIds={activeDrugIds}
        profileGender={profileGender}
        onConfirm={(resolved) => {
          onConfirm(resolved)
          if (index + 1 < items.length) setIndex(index + 1)
          else onDone()
        }}
        onMismatch={onMismatch}
      />
    </section>
  )
}

function TagBadge({ kind }: { kind: TagKind }) {
  const meta = TAG_META[kind]
  return (
    <span className={`tag-badge tag-${kind}`} title={meta.hint}>
      {meta.label}
    </span>
  )
}

function ConfirmItem({
  item,
  payload,
  imageUrl,
  entry,
  activeDrugIds,
  profileGender,
  onConfirm,
  onMismatch,
}: {
  item: DraftItem
  payload: ExtractResponse
  imageUrl: string
  entry: 'A' | 'B'
  activeDrugIds: string[]
  profileGender?: string
  onConfirm: (resolved: ResolvedDraft) => void
  onMismatch: (action: 'retake' | 'manual') => void
}) {
  const plan = item.plan
  const isOtc = !plan && Boolean(item.otcNote)
  const candidateConflict = item.conflicts.find(
    (conflict) => (conflict.type === 'spec' || conflict.type === 'multi') && conflict.candidates?.length,
  )
  const needsCandidate = item.matchStatus === 'conflict' && Boolean(candidateConflict)
  // 信息型冲突（层间冲突等）：无候选可选，仅展示待核对
  const infoConflicts = item.conflicts.filter((conflict) => !conflict.candidates)

  const [selectedId, setSelectedId] = useState('')
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [cycleChoice, setCycleChoice] = useState<'longterm' | 'until-used' | 'custom'>('longterm')
  const [customDays, setCustomDays] = useState('7')
  const [times, setTimes] = useState<string[]>(plan?.times || [])
  const [manualDose, setManualDose] = useState({ value: '', unit: '滴' })
  const [manualFreq, setManualFreq] = useState('')
  const [healthChecked, setHealthChecked] = useState<Record<number, boolean>>({})
  const [rangeCheck, setRangeCheck] = useState(item.rangeCheck)
  const [interactions, setInteractions] = useState(item.interactions)
  const [whoConfirmed, setWhoConfirmed] = useState(false)
  const [mismatchOpen, setMismatchOpen] = useState(false)
  const [manualDrug, setManualDrug] = useState({
    genericName: item.identity.genericName || '',
    specification: item.identity.specification || '',
    form: item.identity.form || '',
    stock: '1',
    stockUnit: '支',
  })

  const resolvedDrug: CandidateDrug | null =
    item.matchedDrug ??
    (needsCandidate && selectedId ? candidateConflict!.candidates!.find((candidate) => candidate.id === selectedId) || null : null)

  const effectiveDose = plan?.dose || (Number(manualDose.value) > 0 ? { value: Number(manualDose.value), unit: manualDose.unit } : null)
  const effectiveFrequency = plan?.frequency || Number(manualFreq) || null

  // 用户在冲突清单中选择候选后，对该候选重跑说明书范围校验与相互作用检查
  useEffect(() => {
    if (!selectedId) return
    const dose = effectiveDose
    fetch('/api/draft-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drugId: selectedId,
        dose: dose ? { value: dose.value, unit: dose.unit } : null,
        frequency: effectiveFrequency,
        activeDrugIds,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data?.rangeCheck) setRangeCheck(data.rangeCheck)
        if (data?.interactions) setInteractions(data.interactions)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const stockDays = resolvedDrug ? estimateStockDays(resolvedDrug.packageStock ?? resolvedDrug.stock, effectiveDose?.value || 0, effectiveFrequency || 0) : 0
  const genderMismatch = Boolean(profileGender && payload.patientHint?.gender && profileGender !== payload.patientHint.gender)

  const doseOk = Boolean(plan?.dose) || Number(manualDose.value) > 0
  const freqOk = Boolean(plan?.frequency) || Number(manualFreq) > 0
  const durationOk =
    !plan || Boolean(plan.durationDays) || cycleChoice === 'longterm' || cycleChoice === 'until-used' || Number(customDays) > 0
  const candidateOk = !needsCandidate || Boolean(selectedId)
  const manualOk = item.matchStatus !== 'unmatched' || Boolean(manualDrug.genericName && manualDrug.specification && manualDrug.form)
  const keyChecksOk =
    isOtc ||
    (doseOk &&
      freqOk &&
      durationOk &&
      (!plan?.dose || checked.dose) &&
      (!plan?.frequency || checked.frequency) &&
      (!plan?.durationDays || checked.duration))
  const whoOk = !genderMismatch || whoConfirmed
  const timesOk = isOtc || times.length > 0
  const canConfirm = candidateOk && manualOk && keyChecksOk && whoOk && timesOk

  function toggleCheck(key: string) {
    setChecked((current) => ({ ...current, [key]: !current[key] }))
  }

  function handleConfirm() {
    let drug: Omit<import('../types').Drug, 'confirmedAt' | 'confirmStatus'>
    let confirmStatus: import('../types').ConfirmStatus

    if (item.matchStatus === 'unmatched') {
      drug = {
        id: `manual-${Date.now()}`,
        genericName: manualDrug.genericName,
        brandName: '（手动建档）',
        specification: manualDrug.specification,
        form: manualDrug.form,
        manufacturer: '',
        approval: '',
        stock: Number(manualDrug.stock) || 0,
        stockUnit: manualDrug.stockUnit,
      }
      confirmStatus = 'manual'
    } else {
      const candidate = resolvedDrug!
      drug = { ...candidate, stock: candidate.packageStock ?? candidate.stock }
      confirmStatus = plan ? 'prescription' : 'ocr-unique'
    }

    let resolvedPlan: ResolvedDraft['plan'] = null
    if (plan) {
      const dose = plan.dose || { value: Number(manualDose.value), unit: manualDose.unit }
      const frequency = plan.frequency || Number(manualFreq)
      const startDate = plan.startDate
      let cycleType: import('../types').CycleType
      let endDate: string | undefined
      if (plan.durationDays) {
        cycleType = 'closed'
        endDate = plan.endDate || addDaysStr(startDate, plan.durationDays)
      } else if (cycleChoice === 'longterm') {
        cycleType = 'open'
      } else if (cycleChoice === 'until-used') {
        cycleType = 'stock'
      } else {
        cycleType = 'closed'
        endDate = addDaysStr(startDate, Number(customDays))
      }
      resolvedPlan = {
        drugId: drug.id,
        dose,
        frequency,
        times,
        meal: '无特殊要求',
        route: plan.route || undefined,
        cycleType,
        startDate,
        endDate,
        source: plan.sourceKind,
        tags: {
          dose: plan.dose ? 'transcribed' : 'user',
          frequency: plan.frequency ? 'transcribed' : 'user',
          duration: plan.durationDays ? 'transcribed' : 'user',
          times: 'assist',
          startDate: 'default',
          endDate: cycleType === 'closed' ? 'derived' : undefined,
        },
      }
    }

    const health = item.healthSuggestions
      .filter((_, i) => healthChecked[i])
      .map((suggestion) => ({ field: suggestion.field, value: suggestion.value }))

    const keySnapshot: Record<string, string> = {
      药名: drug.genericName,
      规格: drug.specification,
      剂型: drug.form,
    }
    if (resolvedPlan) {
      keySnapshot.用量 = `${resolvedPlan.dose.value} ${resolvedPlan.dose.unit}`
      keySnapshot.频次 = `每日 ${resolvedPlan.frequency} 次`
      keySnapshot.疗程 = resolvedPlan.cycleType === 'closed' ? `共 ${plan?.durationDays ?? Number(customDays)} 天` : resolvedPlan.cycleType === 'open' ? '长期服用' : '用完为止'
      if (resolvedPlan.endDate) keySnapshot.结束日期 = resolvedPlan.endDate
    }

    onConfirm({
      drug,
      confirmStatus,
      plan: resolvedPlan,
      health,
      sourceMeta: {
        kind: entry === 'A' ? '处方笺' : plan?.sourceKind === 'label' ? '医院标签' : '药盒',
        hospital: payload.prescription?.hospital || undefined,
        rxNo: payload.prescription?.rxNo || undefined,
        date: payload.prescription?.date || plan?.startDate || undefined,
        confirmMethod: item.matchStatus === 'unmatched' ? '手动建档' : plan ? '处方抄录' : 'OCR 唯一匹配',
        keySnapshot,
      },
      interactions,
    })
  }

  return (
    <div className="confirm-grid">
      {/* 左列：原文对照 + 脱敏执行 */}
      <div className="confirm-left">
        <div className="original-panel">
          <div className="original-head"><FileText size={17} /><strong>原文对照</strong><span>处方/标签原文 ↔ 结构化字段</span></div>
          {imageUrl ? (
            <div className="original-image"><img src={imageUrl} alt="识别原图" /></div>
          ) : (
            <pre className="original-text">{payload.rawText || item.whitelistItem.raw || '（无原文）'}</pre>
          )}
          {payload.prescription && (
            <dl className="original-meta">
              <div><dt>医院</dt><dd>{payload.prescription.hospital || '—'}</dd></div>
              <div><dt>处方号</dt><dd>{payload.prescription.rxNo || '—'}</dd></div>
              <div><dt>日期</dt><dd>{payload.prescription.date || '—'}</dd></div>
              <div><dt>科室</dt><dd>{payload.prescription.department || '—'}</dd></div>
              <div className="full"><dt>诊断</dt><dd>{payload.prescription.diagnosis || '—'}</dd></div>
            </dl>
          )}
          {item.whitelistItem.sigText && (
            <p className="sig-quote">用法原文行：<code>{item.whitelistItem.sigText}</code></p>
          )}
        </div>

        <div className="privacy-panel">
          <div className="original-head"><Lock size={16} /><strong>脱敏执行</strong><span>四层程序</span></div>
          <ul>
            <li className="pass"><Check size={14} />L0 版面裁剪——前记（患者信息）/后记（签名）整块丢弃，只存正文</li>
            <li className="pass"><Check size={14} />L1 白名单——闭合 schema：医院/处方号/日期/科室/诊断/条目</li>
            <li className={payload.sanitized?.length ? 'warn' : 'pass'}>
              {payload.sanitized?.length ? <AlertTriangle size={14} /> : <Check size={14} />}
              L2 兜底扫描——{payload.sanitized?.length
                ? `命中 ${payload.sanitized.reduce((sum, s) => sum + s.count, 0)} 项（${payload.sanitized.map((s) => s.type).join('、')}），已替换 [已脱敏]`
                : '未命中敏感模式'}
            </li>
            <li className="pass"><Check size={14} />L3 出口约束——OCR 原文即用即弃，仅白名单字段发送第三方模型</li>
          </ul>
          <p className="privacy-foot">失败方向统一为"宁可误杀"：审计日志只记剥离类型与次数，不记原文。</p>
        </div>

        <div className="layer-panel">
          <span>层检测</span>
          <div className="layer-chips">{payload.layers?.map((layer) => <span key={layer} className="chip">{layer}</span>)}</div>
        </div>
      </div>

      {/* 右列：结构化字段与核对 */}
      <div className="confirm-right">
        {/* ① 药品身份 */}
        <div className="confirm-card">
          <h3><Pill size={17} />药品身份 <small>身份线 · 药名+规格+剂型严格核对</small></h3>
          {item.matchStatus === 'unmatched' ? (
            <div className="manual-entry">
              <p className="muted-small">身份线无唯一匹配。请手动建档（标注「未经 OCR 确认」，AI 个性化咨询不可用，仅 L0 资料查询）：</p>
              <div className="form-grid">
                <label>药名<input value={manualDrug.genericName} onChange={(e) => setManualDrug({ ...manualDrug, genericName: e.target.value })} placeholder="如：玻璃酸钠滴眼液" /></label>
                <label>规格<input value={manualDrug.specification} onChange={(e) => setManualDrug({ ...manualDrug, specification: e.target.value })} placeholder="如：0.1%（10mL：10mg）" /></label>
                <label>剂型<input value={manualDrug.form} onChange={(e) => setManualDrug({ ...manualDrug, form: e.target.value })} placeholder="如：滴眼液" /></label>
                <label>库存<div className="input-suffix"><input type="number" min="0" value={manualDrug.stock} onChange={(e) => setManualDrug({ ...manualDrug, stock: e.target.value })} /><span>{manualDrug.stockUnit}</span></div></label>
                <label className="full">库存单位<select value={manualDrug.stockUnit} onChange={(e) => setManualDrug({ ...manualDrug, stockUnit: e.target.value })}>{DOSE_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
              </div>
            </div>
          ) : item.matchStatus === 'unique' && resolvedDrug ? (
            <>
              <div className="identity-head">
                <span className="confidence"><BadgeCheck size={14} />唯一匹配 · 待确认</span>
                <h4>{resolvedDrug.genericName}</h4>
                {item.resolutionNote && <p className="resolution-note">{item.resolutionNote}</p>}
              </div>
              <dl className="identity-fields">
                <div><dt>商品名</dt><dd>{resolvedDrug.brandName}</dd></div>
                <div><dt>规格</dt><dd>{resolvedDrug.specification}</dd></div>
                <div><dt>剂型</dt><dd>{resolvedDrug.form}</dd></div>
                <div><dt>厂家</dt><dd>{resolvedDrug.manufacturer}</dd></div>
                <div><dt>批准文号</dt><dd>{resolvedDrug.approval}</dd></div>
              </dl>
              {/* 层间冲突等信息型冲突：不选边，仅列出待核对（PRD §7.2.5） */}
              {infoConflicts.length > 0 && (
                <div className="conflict-list">
                  {infoConflicts.map((conflict, idx) => (
                    <div key={idx} className="conflict-item info">
                      <p>{conflict.note}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="conflict-list">
              <div className="conflict-banner"><CircleAlert size={16} /><span>冲突清单——系统不选边，请核对药品实物后选择：</span></div>
              {item.conflicts.map((conflict, idx) => (
                <div key={idx} className={`conflict-item ${conflict.candidates ? 'needs-choice' : 'info'}`}>
                  <p>{conflict.note}</p>
                  {conflict.candidates?.map((candidate) => (
                    <label key={candidate.id} className={`candidate-card ${selectedId === candidate.id ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="candidate"
                        checked={selectedId === candidate.id}
                        onChange={() => setSelectedId(candidate.id)}
                      />
                      <div>
                        <strong>{candidate.genericName}</strong>
                        <span>{candidate.brandName} · {candidate.specification} · {candidate.form}</span>
                        <small>厂家：{candidate.manufacturer} · 批准文号：{candidate.approval}</small>
                      </div>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ② 医嘱核对 */}
        {plan && (
          <div className="confirm-card">
            <h3><ListChecks size={17} />医嘱核对 <small>医嘱线 · 只抄录不生成，模型输出不写入计划</small></h3>

            <div className="verify-row">
              <div className="verify-field">
                <span>每次用量</span>
                {plan.dose ? (
                  <strong>{plan.dose.value} {plan.dose.unit}</strong>
                ) : (
                  <div className="manual-input">
                    <input type="number" min="0.5" step="0.5" placeholder="人工补录" value={manualDose.value} onChange={(e) => setManualDose({ ...manualDose, value: e.target.value })} />
                    <select value={manualDose.unit} onChange={(e) => setManualDose({ ...manualDose, unit: e.target.value })}>{DOSE_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select>
                  </div>
                )}
                <TagBadge kind={plan.dose ? 'transcribed' : 'user'} />
                {!plan.dose && <em className="missing-hint">规则未抽出该项，请对照原文人工补，系统不预填猜测</em>}
              </div>
              {plan.dose && (
                <label className="verify-check">
                  <input type="checkbox" checked={Boolean(checked.dose)} onChange={() => toggleCheck('dose')} />
                  已核对
                </label>
              )}
            </div>

            <div className="verify-row">
              <div className="verify-field">
                <span>频次</span>
                {plan.frequency ? (
                  <strong>每日 {plan.frequency} 次</strong>
                ) : (
                  <div className="manual-input">
                    <input type="number" min="1" max="8" placeholder="每日几次" value={manualFreq} onChange={(e) => setManualFreq(e.target.value)} />
                    <span>次/日</span>
                  </div>
                )}
                <TagBadge kind={plan.frequency ? 'transcribed' : 'user'} />
              </div>
              {plan.frequency && (
                <label className="verify-check">
                  <input type="checkbox" checked={Boolean(checked.frequency)} onChange={() => toggleCheck('frequency')} />
                  已核对
                </label>
              )}
            </div>

            {plan.route && (
              <div className="verify-row">
                <div className="verify-field"><span>途径</span><strong>{plan.route}</strong><TagBadge kind="transcribed" /></div>
              </div>
            )}

            <div className="verify-row">
              <div className="verify-field">
                <span>疗程</span>
                {plan.durationDays ? (
                  <>
                    <strong>共 {plan.durationDays} 天</strong>
                    <TagBadge kind="transcribed" />
                    <em className="derived-hint">结束日期 {plan.endDate}（推算）<TagBadge kind="derived" /></em>
                  </>
                ) : (
                  <div className="cycle-choice">
                    <label className={cycleChoice === 'longterm' ? 'selected' : ''}>
                      <input type="radio" name="cycle" checked={cycleChoice === 'longterm'} onChange={() => setCycleChoice('longterm')} />
                      <div><strong>长期服用</strong><span>开放式 · 持续提醒直到暂停/结束</span></div>
                    </label>
                    <label className={cycleChoice === 'until-used' ? 'selected' : ''}>
                      <input type="radio" name="cycle" checked={cycleChoice === 'until-used'} onChange={() => setCycleChoice('until-used')} />
                      <div><strong>用完为止</strong><span>按库存推算约 {stockDays} 天 <TagBadge kind="derived" /></span></div>
                    </label>
                    <label className={cycleChoice === 'custom' ? 'selected' : ''}>
                      <input type="radio" name="cycle" checked={cycleChoice === 'custom'} onChange={() => setCycleChoice('custom')} />
                      <div><strong>自定义天数</strong>
                        <span className="custom-days">
                          <input type="number" min="1" value={customDays} onChange={(e) => setCustomDays(e.target.value)} onClick={() => setCycleChoice('custom')} /> 天（封闭式）
                        </span>
                      </div>
                    </label>
                  </div>
                )}
                {!plan.durationDays && <em className="missing-hint">标签上没有疗程——请三选一，开始日期 {plan.startDate}（默认）<TagBadge kind="default" /></em>}
              </div>
              {plan.durationDays && (
                <label className="verify-check">
                  <input type="checkbox" checked={Boolean(checked.duration)} onChange={() => toggleCheck('duration')} />
                  已核对
                </label>
              )}
            </div>
          </div>
        )}

        {/* ③ 服药时间点 */}
        {plan && (
          <div className="confirm-card">
            <h3><Clock3 size={17} />服药时间点 <small>系统建议永不冒充医嘱</small></h3>
            <div className="time-editor">
              {times.map((time, idx) => (
                <div key={idx} className="time-chip">
                  <input
                    type="time"
                    value={time}
                    onChange={(event) => setTimes((current) => current.map((t, i) => (i === idx ? event.target.value : t)))}
                  />
                  <button aria-label="删除时间点" onClick={() => setTimes((current) => current.filter((_, i) => i !== idx))}><X size={13} /></button>
                </div>
              ))}
              <button className="time-add" onClick={() => setTimes((current) => [...current, '08:00'])}><Plus size={13} />添加</button>
              <button
                className="time-add"
                onClick={() => effectiveFrequency && setTimes(suggestTimes(effectiveFrequency))}
                disabled={!effectiveFrequency}
                title="按频次在 8:00–22:00 均匀分布重新生成"
              >
                按频次生成建议
              </button>
              <TagBadge kind="assist" />
            </div>
            <p className="muted-small">建议按频次在 8:00–22:00 均匀分布生成（每日 4 次 → 8/12/16/20），可自由调整。</p>
          </div>
        )}

        {/* OTC 提示 */}
        {isOtc && item.otcNote && (
          <div className="confirm-card otc-card">
            <h3><Package size={17} />自购 OTC · 两步式录入</h3>
            <div className="safety-box"><AlertTriangle size={19} /><p>{item.otcNote}</p></div>
          </div>
        )}

        {/* ④ 健康信息建议填入 */}
        {item.healthSuggestions.length > 0 && (
          <div className="confirm-card">
            <h3><UserRound size={17} />健康信息 · 建议填入 <small>勾选才写入，字段级来源标注</small></h3>
            {item.healthSuggestions.map((suggestion, idx) => (
              <label key={idx} className="check-line health-line">
                <input
                  type="checkbox"
                  checked={Boolean(healthChecked[idx])}
                  onChange={() => setHealthChecked((current) => ({ ...current, [idx]: !current[idx] }))}
                />
                <span><strong>{suggestion.field}：</strong>{suggestion.value}<em>（{suggestion.source} · 已确认）</em></span>
              </label>
            ))}
            <p className="muted-small">产品不做诊断，"诊断"字段语义永远为"用户报告的诊断"；AI 将其视为用户提供的、未经医学验证的信息。</p>
          </div>
        )}

        {/* ⑤ 相互作用检查 */}
        <div className="confirm-card">
          <h3><ShieldCheck size={17} />相互作用检查 <small>对象：新计划 × 当前生效计划集合</small></h3>
          {interactions.has ? (
            <div className="safety-box warn">
              <AlertTriangle size={19} />
              <div>
                {interactions.items.map((hit, idx) => (
                  <p key={idx}><strong>[{hit.level}]</strong> {hit.note} <small>（来源：{hit.source}）</small></p>
                ))}
                <p className="interact-guide">提示不阻止创建、不修改方案——请咨询医生或药师。</p>
              </div>
            </div>
          ) : (
            <div className="notice-inline"><ShieldCheck size={16} /><p>当前生效计划集合未见已知相互作用。演示规则库覆盖有限，未覆盖不表示无风险。</p></div>
          )}
        </div>

        {/* ⑥ 说明书范围校验 */}
        {plan && (
          <div className="confirm-card">
            <h3><Info size={17} />说明书范围校验 <small>规则引擎 · 对照说明书库上限</small></h3>
            {rangeCheck.status === 'pass' && (
              <div className="notice-inline pass"><Check size={16} /><p>医嘱在说明书范围内（依据：{rangeCheck.basis}）。</p></div>
            )}
            {rangeCheck.status === 'exceed' && (
              <div className="safety-box warn"><AlertTriangle size={19} /><div>{rangeCheck.issues.map((issue, idx) => <p key={idx}>{issue}</p>)}</div></div>
            )}
            {rangeCheck.status === 'none' && (
              <div className="notice-inline"><Info size={16} /><p>{rangeCheck.note || '说明书库未收录，跳过范围校验'}</p></div>
            )}
          </div>
        )}

        {/* ⑦ 给谁用的药 */}
        {genderMismatch && (
          <div className="confirm-card who-card">
            <h3><UserRound size={17} />这是给谁用的药？</h3>
            <div className="safety-box warn"><AlertTriangle size={19} /><p>处方患者信息（{payload.patientHint?.gender}）与你的资料（{profileGender}）不一致。请确认本药的使用人后再继续。</p></div>
            <label className="check-line"><input type="checkbox" checked={whoConfirmed} onChange={() => setWhoConfirmed(!whoConfirmed)} />已确认使用人</label>
          </div>
        )}

        {/* 操作 */}
        <div className="confirm-actions">
          <button className="secondary" onClick={() => setMismatchOpen(true)}><X size={17} />信息不符</button>
          <button className="primary" disabled={!canConfirm} onClick={handleConfirm}>
            <Check size={17} />{isOtc ? '确认建档（计划稍后手动创建）' : '确认建档并生效计划'}
          </button>
        </div>
        {!canConfirm && (
          <p className="confirm-hint">
            {!candidateOk && '请先在冲突清单中选择与实物一致的条目；'}
            {!manualOk && '请补全手动建档的药名/规格/剂型；'}
            {!keyChecksOk && '请逐项核对用量/频次/疗程；'}
            {!timesOk && '请至少设置一个服药时间点；'}
            {!whoOk && '请确认本药的使用人。'}
          </p>
        )}
      </div>

      {mismatchOpen && (
        <div className="modal-backdrop" onClick={() => setMismatchOpen(false)}>
          <div className="modal reminder-modal" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setMismatchOpen(false)}><X size={21} /></button>
            <span className="eyebrow">INFORMATION MISMATCH</span>
            <h2>信息不符</h2>
            <p className="modal-subtitle">识别结果与实物不一致时，回到重拍或手动建档，不猜测。</p>
            <div className="button-row">
              <button className="secondary" onClick={() => { setMismatchOpen(false); onMismatch('retake') }}><ChevronRight size={16} />重新拍摄</button>
              <button className="primary" onClick={() => { setMismatchOpen(false); onMismatch('manual') }}>手动建档</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
