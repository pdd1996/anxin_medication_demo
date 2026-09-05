import { useEffect, useState } from 'react'
import {
  Bell,
  Bot,
  Box,
  Camera,
  Check,
  CircleUserRound,
  Home,
  Pill,
  ShieldCheck,
} from 'lucide-react'
import type {
  ChatMessage,
  Drug,
  ExtractResponse,
  HealthEntry,
  MedRecord,
  Plan,
  ResolvedDraft,
  SourceRecord,
  Tab,
} from './types'
import { loadState, todayStr } from './lib'
import { EntryPage, type EntryState } from './pages/Entry'
import { ConfirmPage } from './pages/Confirm'
import { ReminderModal, TodayPage } from './pages/Today'
import { CabinetPage, ManualDrugModal, PlanModal } from './pages/Cabinet'
import { ConsultPage } from './pages/Consult'
import { ProfilePage } from './pages/Profile'
import { InsightPage } from './doctor'

const navItems: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: 'today', label: '用药', icon: Home },
  { id: 'cabinet', label: '药箱', icon: Box },
  { id: 'entry', label: '录入', icon: Camera },
  { id: 'consult', label: 'AI 咨询', icon: Bot },
  { id: 'profile', label: '我的', icon: CircleUserRound },
]

function App() {
  // 路由分流：/doctor/* 走医生端独立外壳（无患者端侧栏），其余走患者端
  const [doctorMode, setDoctorMode] = useState(
    typeof window !== 'undefined' && window.location.pathname.startsWith('/doctor'),
  )
  useEffect(() => {
    const onPop = () => setDoctorMode(window.location.pathname.startsWith('/doctor'))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  if (doctorMode) {
    return (
      <div className="doctor-shell">
        <InsightPage />
      </div>
    )
  }
  return <PatientApp />
}

function PatientApp() {
  const [tab, setTab] = useState<Tab>('today')
  const [drugs, setDrugs] = useState<Drug[]>(() => loadState('med-demo-v2-drugs', []))
  const [plans, setPlans] = useState<Plan[]>(() => loadState('med-demo-v2-plans', []))
  const [records, setRecords] = useState<MedRecord[]>(() => loadState('med-demo-v2-records', []))
  const [health, setHealth] = useState<HealthEntry[]>(() => loadState('med-demo-v2-health', []))
  const [sources, setSources] = useState<SourceRecord[]>(() => loadState('med-demo-v2-sources', []))

  const [entryState, setEntryState] = useState<EntryState>({ step: 'pick', entry: 'A', imageUrl: '' })
  const [showManualDrug, setShowManualDrug] = useState(false)
  const [planTarget, setPlanTarget] = useState<{ drugId: string; plan?: Plan } | null>(null)
  const [reminderPlanId, setReminderPlanId] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  const [question, setQuestion] = useState('')
  const [consultLoading, setConsultLoading] = useState(false)
  const [listening, setListening] = useState(false)
  const [selectedDrugId, setSelectedDrugId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: '你好，我可以基于本地说明书库解释已确认药品的信息（含药理机制），并提示生效计划中的相互作用。涉及诊断、停换药或剂量调整时，我会建议你咨询医生或药师。',
    },
  ])

  useEffect(() => localStorage.setItem('med-demo-v2-drugs', JSON.stringify(drugs)), [drugs])
  useEffect(() => localStorage.setItem('med-demo-v2-plans', JSON.stringify(plans)), [plans])
  useEffect(() => localStorage.setItem('med-demo-v2-records', JSON.stringify(records)), [records])
  useEffect(() => localStorage.setItem('med-demo-v2-health', JSON.stringify(health)), [health])
  useEffect(() => localStorage.setItem('med-demo-v2-sources', JSON.stringify(sources)), [sources])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const today = todayStr()
  const activePlans = plans.filter((plan) => plan.status === 'active' && plan.startDate <= today && (!plan.endDate || plan.endDate >= today))
  const activeDrugIds = [...new Set(activePlans.map((plan) => plan.drugId))]
  const profileGender = health.find((entry) => entry.field === '性别')?.value
  const hasPendingToday = activePlans.some((plan) =>
    plan.times.some((time) => !records.some((record) => record.date === today && record.planId === plan.id && record.time === time)),
  )

  // -----------------------------------------------------------------------
  // 拍照录入 · 双线提取流程
  // -----------------------------------------------------------------------
  async function runExtract(options: { entry: 'A' | 'B'; image?: string; demoSample?: string }) {
    setEntryState({
      step: 'processing',
      entry: options.entry,
      imageUrl: options.image || '',
      image: options.image,
      demoSample: options.demoSample,
    })
    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...options, activeDrugIds }),
      })
      const payload = (await response.json()) as ExtractResponse
      if (!response.ok) throw new Error(payload.error || '提取服务调用失败')
      if (payload.unsupported) {
        setEntryState((current) => ({ ...current, step: 'error', error: payload.error, unsupported: true, payload }))
        return
      }
      if (!payload.ok) {
        setEntryState((current) => ({ ...current, step: 'error', error: payload.error || '无法可靠识别' }))
        return
      }
      if (payload.layerWarning) {
        setEntryState((current) => ({ ...current, step: 'warning', payload }))
        return
      }
      setEntryState((current) => ({ ...current, step: 'confirm', payload }))
    } catch (error) {
      setEntryState((current) => ({
        ...current,
        step: 'error',
        error: error instanceof Error ? error.message : '识别失败，请重试',
      }))
    }
  }

  function switchEntryAndRerun() {
    const current = entryState
    runExtract({
      entry: current.entry === 'A' ? 'B' : 'A',
      image: current.image,
      demoSample: current.demoSample,
    })
  }

  // 确认页提交：建档 + 计划生效 + 健康信息按勾选写入 + 来源留痕
  function confirmDraft(resolved: ResolvedDraft) {
    const now = new Date().toISOString()
    const sourceId = `src-${Date.now()}`
    const drug: Drug = { ...resolved.drug, sourceId, confirmedAt: now, confirmStatus: resolved.confirmStatus }
    setDrugs((current) =>
      current.some((item) => item.id === drug.id) ? current.map((item) => (item.id === drug.id ? drug : item)) : [...current, drug],
    )
    if (resolved.plan) {
      const plan: Plan = { ...resolved.plan, id: `plan-${Date.now()}`, status: 'active', createdAt: now, sourceId }
      setPlans((current) => [...current, plan])
    }
    if (resolved.health.length > 0) {
      setHealth((current) => [
        ...current,
        ...resolved.health
          .filter((item) => !current.some((entry) => entry.field === item.field))
          .map((item, index) => ({
            id: `h-${Date.now()}-${index}`,
            field: item.field,
            value: item.value,
            source: 'prescription' as const,
            confirmedAt: now,
          })),
      ])
    }
    setSources((current) => [...current, { id: sourceId, ...resolved.sourceMeta, confirmedAt: now }])
    setToast(
      resolved.interactions.has
        ? `已确认入箱并生效计划；检测到 ${resolved.interactions.items.length} 项相互作用提示（${resolved.interactions.items[0].level}），请咨询医生或药师`
        : resolved.plan
          ? '已确认入箱，计划生效（网页打开时将模拟提醒）'
          : '已确认建档；可在药箱中手动创建计划',
    )
  }

  // -----------------------------------------------------------------------
  // 提醒与服药记录：已服 / 稍后 / 跳过，库存按次扣减
  // -----------------------------------------------------------------------
  function updateTask(planId: string, time: string, status: 'taken' | 'skipped' | 'later') {
    const recordId = `${planId}-${today}-${time}`
    setRecords((current) => [
      ...current.filter((record) => record.id !== recordId),
      { id: recordId, planId, date: today, time, status, updatedAt: new Date().toISOString() },
    ])
    if (status === 'taken') {
      const plan = plans.find((item) => item.id === planId)
      if (plan) {
        setDrugs((current) =>
          current.map((drug) => {
            if (drug.id !== plan.drugId) return drug
            const next = { ...drug, stock: Math.max(0, drug.stock - plan.dose.value) }
            if (!next.openedAt) next.openedAt = today // 三条时间线：首次使用视为开封（演示）
            return next
          }),
        )
      }
      setToast('已记录服药，库存已按次扣减')
    } else {
      setToast(status === 'later' ? '已设置稍后提醒（演示）' : '已记录跳过，本应用不会建议加倍补服')
    }
    setReminderPlanId(null)
  }

  // 相互作用检查时机二：计划变更导致用药集合变化时重跑（PRD V2 §7.8.2）
  function recheckInteractions(nextPlans: Plan[]) {
    const ids = [...new Set(nextPlans.filter((plan) => plan.status === 'active').map((plan) => plan.drugId))]
    if (ids.length < 2) return
    fetch('/api/interactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeDrugIds: ids }),
    })
      .then((response) => response.json())
      .then((payload) => {
        if (payload?.has) {
          setToast(
            `用药集合变化——检测到 ${payload.items.length} 项相互作用提示（${payload.items[0].level}）：${payload.items[0].note}。请咨询医生或药师`,
          )
        }
      })
      .catch(() => {})
  }

  function savePlan(
    drugId: string,
    existing: Plan | undefined,
    data: { dose: { value: number; unit: string }; frequency: number; times: string[]; meal: string; cycleType: 'closed' | 'open' | 'stock'; endDate?: string },
  ) {
    const now = new Date().toISOString()
    let nextPlans: Plan[]
    if (existing) {
      nextPlans = plans.map((plan) =>
        plan.id === existing.id
          ? { ...plan, ...data, tags: { ...plan.tags, dose: 'user', frequency: 'user', duration: 'user', times: 'assist' } }
          : plan,
      )
      setToast('计划已更新')
    } else {
      nextPlans = [
        ...plans,
        {
          id: `plan-${Date.now()}`,
          drugId,
          ...data,
          status: 'active',
          source: 'manual',
          startDate: today,
          tags: { dose: 'user', frequency: 'user', duration: 'user', times: 'assist', startDate: 'default' },
          createdAt: now,
        },
      ]
      setToast('计划已创建，网页打开时将模拟提醒')
    }
    setPlans(nextPlans)
    setPlanTarget(null)
    setTab('today')
    recheckInteractions(nextPlans)
  }

  function togglePausePlan(plan: Plan) {
    const nextPlans = plans.map((item) =>
      item.id === plan.id ? { ...item, status: item.status === 'active' ? ('paused' as const) : ('active' as const) } : item,
    )
    setPlans(nextPlans)
    setToast(plan.status === 'active' ? '计划已暂停，不再提醒' : '计划已恢复，继续提醒')
    recheckInteractions(nextPlans)
  }

  function endPlan(plan: Plan) {
    const nextPlans = plans.map((item) => (item.id === plan.id ? { ...item, status: 'ended' as const } : item))
    setPlans(nextPlans)
    setToast('计划已结束；药品仍在药箱，开封效期提示继续有效')
    recheckInteractions(nextPlans)
  }

  function deleteDrug(drugId: string) {
    setDrugs((current) => current.filter((drug) => drug.id !== drugId))
    const nextPlans = plans.filter((plan) => plan.drugId !== drugId)
    setPlans(nextPlans)
    recheckInteractions(nextPlans)
    setToast('药品及其计划已删除')
  }

  function addManualDrug(data: { genericName: string; specification: string; form: string; stock: number; stockUnit: string }) {
    const now = new Date().toISOString()
    const sourceId = `src-${Date.now()}`
    const drug: Drug = {
      id: `manual-${Date.now()}`,
      ...data,
      brandName: '（手动建档）',
      manufacturer: '',
      approval: '',
      confirmStatus: 'manual',
      sourceId,
      confirmedAt: now,
    }
    setDrugs((current) => [...current, drug])
    setSources((current) => [
      ...current,
      {
        id: sourceId,
        kind: '手动建档',
        confirmMethod: '用户直接填写（兜底路径）',
        confirmedAt: now,
        keySnapshot: { 药名: drug.genericName, 规格: drug.specification, 剂型: drug.form },
      },
    ])
    setShowManualDrug(false)
    setTab('cabinet')
    setToast('已手动建档（未经 OCR 确认，AI 个性化咨询不可用，仅 L0 资料查询）')
  }

  // -----------------------------------------------------------------------
  // AI 咨询：本地说明书库按键取数 + 相互作用注入 + citations
  // -----------------------------------------------------------------------
  async function askAI(text = question) {
    const prompt = text.trim()
    if (!prompt || consultLoading) return
    const drug = drugs.find((item) => item.id === selectedDrugId) || drugs[0]
    const userMessage: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text: prompt }
    const pendingId = `a-${Date.now()}`
    setMessages((current) => [
      ...current,
      userMessage,
      { id: pendingId, role: 'assistant', text: '正在整理回答…', loading: true },
    ])
    setQuestion('')
    setConsultLoading(true)
    if (!drug) {
      setMessages((current) =>
        current.map((message) =>
          message.id === pendingId
            ? { ...message, text: '请先通过「录入」完成药品建档。药品身份未确认前，我不能提供个性化用药信息。' }
            : message,
        ),
      )
      setConsultLoading(false)
      return
    }
    try {
      const response = await fetch('/api/consult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: prompt,
          drug: {
            id: drug.id,
            genericName: drug.genericName,
            specification: drug.specification,
            form: drug.form,
            confirmStatus: drug.confirmStatus,
          },
          activeDrugIds,
        }),
      })
      const payload = (await response.json()) as {
        answer?: string
        status?: string
        error?: string
        notice?: string
        l0Notice?: string
        sections?: ChatMessage['sections']
        citations?: string[]
      }
      if (!response.ok || !payload.answer) throw new Error(payload.error || 'AI 服务调用失败')
      setMessages((current) =>
        current.map((message) =>
          message.id === pendingId
            ? {
              id: pendingId,
              role: 'assistant',
              text: payload.answer!,
              urgent: payload.status === 'emergency',
              status: payload.status,
              notice: payload.notice,
              l0Notice: payload.l0Notice,
              sections: payload.sections,
              citations: payload.citations,
            }
            : message,
        ),
      )
    } catch (error) {
      setMessages((current) =>
        current.map((message) =>
          message.id === pendingId
            ? {
              ...message,
              text: `暂时无法获取 AI 回答：${error instanceof Error ? error.message : '服务不可用'}。药箱和提醒功能不受影响。`,
            }
            : message,
        ),
      )
    } finally {
      setConsultLoading(false)
    }
  }

  function speak(text: string) {
    if (!('speechSynthesis' in window)) {
      setToast('当前浏览器不支持语音播报')
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'zh-CN'
    utterance.rate = 0.92
    window.speechSynthesis.speak(utterance)
  }

  function startVoice() {
    interface RecognitionResultEvent {
      results: { 0: { 0: { transcript: string } } }
    }
    interface RecognitionInstance {
      lang: string
      interimResults: boolean
      start: () => void
      stop: () => void
      onresult: (event: RecognitionResultEvent) => void
      onend: () => void
      onerror: () => void
    }
    const SpeechRecognition = (
      window as unknown as { SpeechRecognition?: new () => RecognitionInstance; webkitSpeechRecognition?: new () => RecognitionInstance }
    ).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => RecognitionInstance }).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setToast('当前浏览器不支持语音输入，请使用文字')
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = 'zh-CN'
    recognition.interimResults = false
    recognition.onresult = (event) => setQuestion(event.results[0][0].transcript)
    recognition.onend = () => setListening(false)
    recognition.onerror = () => {
      setListening(false)
      setToast('没有听清，请重试或使用文字输入')
    }
    setListening(true)
    recognition.start()
  }

  function resetDemo() {
    for (const key of ['med-demo-v2-drugs', 'med-demo-v2-plans', 'med-demo-v2-records', 'med-demo-v2-health', 'med-demo-v2-sources', 'med-demo-drugs', 'med-demo-plans']) {
      localStorage.removeItem(key)
    }
    setDrugs([])
    setPlans([])
    setRecords([])
    setHealth([])
    setSources([])
    setMessages((current) => current.slice(0, 1))
    setEntryState({ step: 'pick', entry: 'A', imageUrl: '' })
    setTab('today')
    setToast('演示数据已恢复')
  }

  const reminderPlan = reminderPlanId ? plans.find((plan) => plan.id === reminderPlanId) : undefined
  const reminderDrug = reminderPlan ? drugs.find((drug) => drug.id === reminderPlan.drugId) : undefined
  const planTargetDrug = planTarget ? drugs.find((drug) => drug.id === planTarget.drugId) : undefined

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><Pill size={24} /></span>
          <div><strong>安心用药</strong><small>AnxinMed</small></div>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={tab === item.id ? 'nav-item active' : 'nav-item'}
                onClick={() => setTab(item.id)}
              >
                <Icon size={21} /><span>{item.label}</span>
                {item.id === 'entry' && <i>核心</i>}
              </button>
            )
          })}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={20} />
          <div><strong>内部演示版本</strong><span>不用于真实诊疗或用药决策</span></div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">安心用药 · MVP DEMO · PRD V2</span>
            <h1>{navItems.find((item) => item.id === tab)?.label}</h1>
          </div>
          <div className="top-actions">
            <button
              className="icon-button"
              aria-label="提醒"
              onClick={() => {
                const planWithPending = activePlans.find((plan) =>
                  plan.times.some((time) => !records.some((record) => record.date === today && record.planId === plan.id && record.time === time)),
                )
                if (planWithPending) setReminderPlanId(planWithPending.id)
              }}
            >
              <Bell size={20} />
              {hasPendingToday && <span className="dot" />}
            </button>
            <div className="avatar">安</div>
          </div>
        </header>

        <div className="content">
          {tab === 'today' && (
            <TodayPage
              drugs={drugs}
              plans={plans}
              records={records}
              onScan={() => setTab('entry')}
              onConsult={() => setTab('consult')}
              onEntry={() => setTab('entry')}
              onRemind={setReminderPlanId}
            />
          )}
          {tab === 'cabinet' && (
            <CabinetPage
              drugs={drugs}
              plans={plans}
              sources={sources}
              onEntry={() => setTab('entry')}
              onManual={() => setShowManualDrug(true)}
              onPlan={(drugId, plan) => setPlanTarget({ drugId, plan })}
              onTogglePause={togglePausePlan}
              onEndPlan={endPlan}
              onDelete={deleteDrug}
            />
          )}
          {tab === 'entry' && (
            entryState.step === 'confirm' && entryState.payload ? (
              <ConfirmPage
                payload={entryState.payload}
                imageUrl={entryState.imageUrl}
                entry={entryState.entry}
                activeDrugIds={activeDrugIds}
                profileGender={profileGender}
                onConfirm={confirmDraft}
                onDone={() => {
                  setEntryState({ step: 'pick', entry: 'A', imageUrl: '' })
                  setTab('cabinet')
                }}
                onMismatch={(action) => {
                  if (action === 'retake') setEntryState({ step: 'upload', entry: entryState.entry, imageUrl: '' })
                  else {
                    setEntryState({ step: 'pick', entry: 'A', imageUrl: '' })
                    setShowManualDrug(true)
                  }
                }}
              />
            ) : (
              <EntryPage
                state={entryState}
                onPickEntry={(entry) => setEntryState({ step: 'upload', entry, imageUrl: '' })}
                onUpload={(entry, image, previewUrl) => runExtract({ entry, image })}
                onDemoSample={(entry, demoSample) => runExtract({ entry, demoSample })}
                onSwitchEntry={switchEntryAndRerun}
                onContinueAnyway={() => setEntryState((current) => ({ ...current, step: 'confirm' }))}
                onBackToUpload={() => setEntryState((current) => ({ ...current, step: 'upload', imageUrl: '' }))}
                onManual={() => {
                  setEntryState({ step: 'pick', entry: 'A', imageUrl: '' })
                  setShowManualDrug(true)
                }}
                onBackToPick={() => setEntryState({ step: 'pick', entry: 'A', imageUrl: '' })}
              />
            )
          )}
          {tab === 'consult' && (
            <ConsultPage
              drugs={drugs}
              selectedDrugId={selectedDrugId}
              messages={messages}
              question={question}
              listening={listening}
              consultLoading={consultLoading}
              onSelectedDrug={setSelectedDrugId}
              onQuestion={setQuestion}
              onAsk={askAI}
              onVoice={startVoice}
              onSpeak={speak}
            />
          )}
          {tab === 'profile' && (
            <ProfilePage
              health={health}
              sources={sources}
              onAddHealth={(field, value) =>
                setHealth((current) => [
                  ...current.filter((entry) => entry.field !== field),
                  { id: `h-${Date.now()}`, field, value, source: 'user' as const },
                ])
              }
              onDeleteHealth={(id) => setHealth((current) => current.filter((entry) => entry.id !== id))}
              onReset={resetDemo}
            />
          )}
        </div>
      </main>

      <div className="mobile-nav">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
              <Icon size={20} /><span>{item.label}</span>
            </button>
          )
        })}
      </div>

      {planTarget && planTargetDrug && (
        <PlanModal
          drug={planTargetDrug}
          plan={planTarget.plan}
          onClose={() => setPlanTarget(null)}
          onSave={(data) => savePlan(planTarget.drugId, planTarget.plan, data)}
        />
      )}
      {showManualDrug && <ManualDrugModal onClose={() => setShowManualDrug(false)} onSave={addManualDrug} />}
      {reminderPlan && reminderDrug && (
        <ReminderModal
          drug={reminderDrug}
          plan={reminderPlan}
          records={records}
          onClose={() => setReminderPlanId(null)}
          onUpdate={updateTask}
          onSpeak={speak}
        />
      )}
      {toast && <div className="toast"><Check size={18} />{toast}</div>}
    </div>
  )
}

export default App
