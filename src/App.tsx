import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  Bot,
  Box,
  Camera,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  History,
  Home,
  ImagePlus,
  Info,
  LoaderCircle,
  Mic,
  PackageCheck,
  Pause,
  Pill,
  Play,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  X,
} from 'lucide-react'

type Tab = 'today' | 'cabinet' | 'scan' | 'consult' | 'profile'
type TaskStatus = 'pending' | 'taken' | 'skipped' | 'later'

interface Drug {
  id: string
  genericName: string
  brandName: string
  specification: string
  form: string
  manufacturer: string
  approval: string
  stock: number
  expiry: string
  confirmedAt: string
}

interface Plan {
  id: string
  drugId: string
  dose: string
  time: string
  meal: string
  status: TaskStatus
  updatedAt?: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  urgent?: boolean
  loading?: boolean
  status?: string
  notice?: string
  sections?: {
    summary: string
    keyPoints: string[]
    risks: string[]
    nextAction: string
    warning: string
  }
  citations?: string[]
}

const MOCK_DRUG: Omit<Drug, 'confirmedAt'> = {
  id: 'mock-amlodipine-5',
  genericName: '苯磺酸氨氯地平片',
  brandName: '络活喜（演示数据）',
  specification: '5 mg × 7片',
  form: '片剂',
  manufacturer: '辉瑞制药有限公司',
  approval: '国药准字 H10950224',
  stock: 28,
  expiry: '2027-12-31',
}

const navItems: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: 'today', label: '用药', icon: Home },
  { id: 'cabinet', label: '药箱', icon: Box },
  { id: 'scan', label: '识药', icon: Camera },
  { id: 'consult', label: 'AI 咨询', icon: Bot },
  { id: 'profile', label: '我的', icon: CircleUserRound },
]

const quickQuestions = ['这个药通常用于什么？', '常见不良反应有哪些？', '这个药应该怎么保存？']

function loadState<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    return stored ? (JSON.parse(stored) as T) : fallback
  } catch {
    return fallback
  }
}

function App() {
  const [tab, setTab] = useState<Tab>('today')
  const [drugs, setDrugs] = useState<Drug[]>(() => loadState('med-demo-drugs', []))
  const [plans, setPlans] = useState<Plan[]>(() => loadState('med-demo-plans', []))
  const [scanStep, setScanStep] = useState<'upload' | 'processing' | 'confirm' | 'error'>('upload')
  const [imageUrl, setImageUrl] = useState('')
  const [scanDrug, setScanDrug] = useState<Omit<Drug, 'confirmedAt'> | null>(null)
  const [scanError, setScanError] = useState('')
  const [showPlan, setShowPlan] = useState(false)
  const [showReminder, setShowReminder] = useState(false)
  const [toast, setToast] = useState('')
  const [question, setQuestion] = useState('')
  const [consultLoading, setConsultLoading] = useState(false)
  const [listening, setListening] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: '你好，我可以解释已确认药品的说明书信息。涉及诊断、停换药或剂量调整时，我会建议你咨询医生或药师。',
    },
  ])
  const fileRef = useRef<HTMLInputElement>(null)
  const task = plans[0]
  const activeDrug = drugs.find((drug) => drug.id === task?.drugId) ?? drugs[0]

  useEffect(() => localStorage.setItem('med-demo-drugs', JSON.stringify(drugs)), [drugs])
  useEffect(() => localStorage.setItem('med-demo-plans', JSON.stringify(plans)), [plans])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2400)
    return () => window.clearTimeout(timer)
  }, [toast])

  const progress = useMemo(() => {
    if (!plans.length) return 0
    return Math.round((plans.filter((plan) => plan.status === 'taken').length / plans.length) * 100)
  }, [plans])

  async function chooseImage(file?: File) {
    if (!file) return
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setImageUrl(URL.createObjectURL(file))
    setScanStep('processing')
    setScanError('')
    setScanDrug(null)
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('无法读取图片'))
        reader.readAsDataURL(file)
      })
      const response = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      })
      const payload = (await response.json()) as { match?: Omit<Drug, 'confirmedAt'>; error?: string; message?: string }
      if (!response.ok) throw new Error(payload.error || 'OCR 服务调用失败')
      if (!payload.match) throw new Error(payload.message || '无法在 Mock 药品库中唯一匹配')
      setScanDrug(payload.match)
      setScanStep('confirm')
    } catch (error) {
      setScanError(error instanceof Error ? error.message : '识别失败，请重试')
      setScanStep('error')
    }
  }

  function confirmDrug() {
    if (!scanDrug) return
    const drug: Drug = { ...scanDrug, confirmedAt: new Date().toISOString() }
    setDrugs((current) => (current.some((item) => item.id === drug.id) ? current : [...current, drug]))
    setToast('已安全加入个人药箱')
    setScanStep('upload')
    setTab('cabinet')
  }

  function createPlan(data: { dose: string; time: string; meal: string }) {
    if (!activeDrug) return
    const plan: Plan = {
      id: `plan-${Date.now()}`,
      drugId: activeDrug.id,
      dose: data.dose,
      time: data.time,
      meal: data.meal,
      status: 'pending',
    }
    setPlans([plan])
    setShowPlan(false)
    setTab('today')
    setToast('计划已创建，网页打开时将模拟提醒')
  }

  function updateTask(status: TaskStatus) {
    if (!task) return
    setPlans((current) =>
      current.map((plan) =>
        plan.id === task.id ? { ...plan, status, updatedAt: new Date().toISOString() } : plan,
      ),
    )
    if (status === 'taken') {
      setDrugs((current) =>
        current.map((drug) =>
          drug.id === task.drugId ? { ...drug, stock: Math.max(0, drug.stock - Number.parseFloat(task.dose) || 1) } : drug,
        ),
      )
      setToast('已记录服药，库存已同步')
    } else {
      setToast(status === 'later' ? '已设置 10 分钟后提醒（演示）' : '已记录跳过，本应用不会建议加倍补服')
    }
    setShowReminder(false)
  }

  async function askAI(text = question) {
    const prompt = text.trim()
    if (!prompt || consultLoading) return
    const userMessage: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text: prompt }
    const pendingId = `a-${Date.now()}`
    setMessages((current) => [
      ...current,
      userMessage,
      { id: pendingId, role: 'assistant', text: '正在整理回答…', loading: true },
    ])
    setQuestion('')
    setConsultLoading(true)
    if (!activeDrug) {
      setMessages((current) =>
        current.map((message) =>
          message.id === pendingId
            ? { id: pendingId, role: 'assistant', text: '请先通过“识药”完成药品确认。药品身份未确认前，我不能提供个性化用药信息。' }
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
        body: JSON.stringify({ question: prompt, drug: activeDrug }),
      })
      const payload = (await response.json()) as {
        answer?: string
        status?: string
        error?: string
        notice?: string
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
                id: pendingId,
                role: 'assistant',
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
    localStorage.removeItem('med-demo-drugs')
    localStorage.removeItem('med-demo-plans')
    setDrugs([])
    setPlans([])
    setMessages((current) => current.slice(0, 1))
    setTab('today')
    setToast('演示数据已恢复')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><Pill size={24} /></span>
          <div><strong>安心用药</strong><small>CARE MED</small></div>
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
                {item.id === 'scan' && <i>核心</i>}
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
            <span className="eyebrow">安心用药 · MVP DEMO</span>
            <h1>{navItems.find((item) => item.id === tab)?.label}</h1>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="提醒" onClick={() => task && setShowReminder(true)}>
              <Bell size={20} />
              {task?.status === 'pending' && <span className="dot" />}
            </button>
            <div className="avatar">安</div>
          </div>
        </header>

        <div className="content">
          {tab === 'today' && (
            <TodayPage
              drug={activeDrug}
              task={task}
              progress={progress}
              onScan={() => setTab('scan')}
              onConsult={() => setTab('consult')}
              onCreatePlan={() => setShowPlan(true)}
              onRemind={() => setShowReminder(true)}
            />
          )}
          {tab === 'cabinet' && (
            <CabinetPage
              drugs={drugs}
              plans={plans}
              onScan={() => setTab('scan')}
              onPlan={() => setShowPlan(true)}
              onDelete={(id) => {
                setDrugs((current) => current.filter((drug) => drug.id !== id))
                setPlans((current) => current.filter((plan) => plan.drugId !== id))
              }}
            />
          )}
          {tab === 'scan' && (
            <ScanPage
              step={scanStep}
              imageUrl={imageUrl}
              candidate={scanDrug}
              error={scanError}
              fileRef={fileRef}
              onFile={chooseImage}
              onReset={() => {
                setScanStep('upload')
                setScanError('')
              }}
              onConfirm={confirmDrug}
            />
          )}
          {tab === 'consult' && (
            <ConsultPage
              drug={activeDrug}
              messages={messages}
              question={question}
              listening={listening}
              onQuestion={setQuestion}
              onAsk={askAI}
              onVoice={startVoice}
              onSpeak={speak}
            />
          )}
          {tab === 'profile' && <ProfilePage onReset={resetDemo} />}
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

      {showPlan && activeDrug && <PlanModal drug={activeDrug} onClose={() => setShowPlan(false)} onSave={createPlan} />}
      {showReminder && task && activeDrug && (
        <ReminderModal drug={activeDrug} task={task} onClose={() => setShowReminder(false)} onUpdate={updateTask} onSpeak={speak} />
      )}
      {toast && <div className="toast"><Check size={18} />{toast}</div>}
    </div>
  )
}

function TodayPage({
  drug,
  task,
  progress,
  onScan,
  onConsult,
  onCreatePlan,
  onRemind,
}: {
  drug?: Drug
  task?: Plan
  progress: number
  onScan: () => void
  onConsult: () => void
  onCreatePlan: () => void
  onRemind: () => void
}) {
  const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())
  return (
    <section className="page-grid">
      <div className="hero-card">
        <div>
          <span className="date-label">{date}</span>
          <h2>{task?.status === 'taken' ? '今天的用药已记录' : task ? '按时用药，安心每一天' : '从识别第一盒药开始'}</h2>
          <p>{task ? '所有提醒均来自你亲自确认的计划。' : '拍摄完整药盒，确认信息后即可建立计划。'}</p>
        </div>
        <div className="progress-ring" style={{ '--progress': `${progress * 3.6}deg` } as React.CSSProperties}>
          <span>{progress}%</span><small>今日完成</small>
        </div>
      </div>

      {!task ? (
        <div className="empty-journey full-span">
          <div className="journey-icon"><PackageCheck size={34} /></div>
          <h3>{drug ? '药品已在药箱，下一步创建计划' : '还没有今日用药任务'}</h3>
          <p>{drug ? '请按照处方或药师指导填写用量和时间。' : '完成识药后，可建立你的第一条服药计划。'}</p>
          <button className="primary" onClick={drug ? onCreatePlan : onScan}>{drug ? '创建服药计划' : '拍照识药'}<ChevronRight size={18} /></button>
        </div>
      ) : (
        <div className="task-card full-span">
          <div className="task-time"><Clock3 size={20} /><strong>{task.time}</strong><span>{task.meal}</span></div>
          <div className="drug-symbol"><Pill size={28} /></div>
          <div className="task-info">
            <span className="status-chip">{task.status === 'taken' ? '已服' : task.status === 'skipped' ? '已跳过' : task.status === 'later' ? '稍后提醒' : '待服用'}</span>
            <h3>{drug?.genericName}</h3>
            <p>{drug?.specification} · 每次 {task.dose} 片</p>
          </div>
          <button className="primary" onClick={onRemind}>{task.status === 'pending' ? '处理提醒' : '查看记录'}</button>
        </div>
      )}

      <button className="action-card mint" onClick={onScan}>
        <span><Camera size={24} /></span><div><strong>拍照识药</strong><small>上传药盒，识别并核对信息</small></div><ChevronRight size={20} />
      </button>
      <button className="action-card sand" onClick={onConsult}>
        <span><Sparkles size={24} /></span><div><strong>问问 AI</strong><small>解释说明书与常见注意事项</small></div><ChevronRight size={20} />
      </button>

      <div className="notice-card full-span">
        <Info size={20} />
        <div><strong>网页提醒说明</strong><p>本 Demo 仅在页面打开时模拟提醒，关闭页面后不会发送系统通知。</p></div>
      </div>
    </section>
  )
}

function CabinetPage({
  drugs,
  plans,
  onScan,
  onPlan,
  onDelete,
}: {
  drugs: Drug[]
  plans: Plan[]
  onScan: () => void
  onPlan: () => void
  onDelete: (id: string) => void
}) {
  return (
    <section>
      <div className="section-heading"><div><span className="eyebrow">MY MEDICINE CABINET</span><h2>我的药箱</h2><p>仅展示经过你确认的药品</p></div><button className="primary" onClick={onScan}><Plus size={18} />添加药品</button></div>
      {drugs.length === 0 ? (
        <div className="empty-journey"><div className="journey-icon"><Box size={34} /></div><h3>药箱还是空的</h3><p>上传药盒照片，识别并确认后加入药箱。</p><button className="primary" onClick={onScan}>开始识药</button></div>
      ) : (
        <div className="drug-grid">
          {drugs.map((drug) => (
            <article className="drug-card" key={drug.id}>
              <div className="drug-cover"><Pill size={42} /><span>MOCK</span></div>
              <div className="drug-content">
                <div className="verified"><ShieldCheck size={15} />用户已确认</div>
                <h3>{drug.genericName}</h3><p>{drug.brandName}</p>
                <dl><div><dt>规格</dt><dd>{drug.specification}</dd></div><div><dt>库存</dt><dd>{drug.stock} 片</dd></div><div><dt>有效期</dt><dd>{drug.expiry}</dd></div></dl>
                <div className="card-actions">
                  <button className="secondary" onClick={onPlan}>{plans.some((plan) => plan.drugId === drug.id) ? '编辑计划' : '创建计划'}</button>
                  <button className="danger-icon" aria-label="删除药品" onClick={() => onDelete(drug.id)}><Trash2 size={18} /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function ScanPage({
  step,
  imageUrl,
  candidate,
  error,
  fileRef,
  onFile,
  onReset,
  onConfirm,
}: {
  step: 'upload' | 'processing' | 'confirm' | 'error'
  imageUrl: string
  candidate: Omit<Drug, 'confirmedAt'> | null
  error: string
  fileRef: React.RefObject<HTMLInputElement | null>
  onFile: (file?: File) => void
  onReset: () => void
  onConfirm: () => void
}) {
  return (
    <section className="scan-layout">
      <div className="scan-main">
        <div className="section-heading compact"><div><span className="eyebrow">IDENTIFY MEDICINE</span><h2>拍照识药</h2><p>请上传药盒正面或说明书，散装药片无法可靠识别。</p></div></div>
        {step === 'upload' && (
          <div className="upload-zone" onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept="image/*" onChange={(event) => onFile(event.target.files?.[0])} hidden />
            <div className="camera-frame"><ImagePlus size={38} /><span className="corner c1" /><span className="corner c2" /><span className="corner c3" /><span className="corner c4" /></div>
            <h3>上传完整、清晰的药盒照片</h3><p>避免反光、遮挡和过暗，建议同时拍摄正反面</p>
            <button className="primary"><Camera size={19} />选择照片</button>
            <small>上传即表示你了解图片可能包含健康信息；Demo 数据仅保存在本机浏览器。</small>
          </div>
        )}
        {step === 'processing' && (
          <div className="processing">
            <div className="preview"><img src={imageUrl} alt="待识别药盒" /><div className="scan-line" /></div>
            <LoaderCircle className="spin" size={28} /><h3>正在识别包装文字</h3><p>Qwen3-VL-Flash 正在提取字段并匹配本地 Mock 药品库…</p>
          </div>
        )}
        {step === 'error' && (
          <div className="processing">
            <div className="journey-icon"><AlertTriangle size={34} /></div>
            <h3>无法可靠识别</h3>
            <p>{error}</p>
            <div className="safety-box"><AlertTriangle size={19} /><p>请勿根据本次结果服药或调整药物。建议补拍药盒正反面，或请药师现场确认。</p></div>
            <button className="primary" onClick={onReset}><RotateCcw size={18} />重新上传</button>
          </div>
        )}
        {step === 'confirm' && candidate && (
          <div className="result-panel">
            <div className="result-preview"><img src={imageUrl} alt="已识别药盒" /><span><Check size={16} />图片质量通过</span></div>
            <div className="result-data">
              <div className="result-head"><div><span className="confidence">唯一匹配 · 待确认</span><h3>{candidate.genericName}</h3></div><ShieldCheck size={28} /></div>
              <dl>
                <div><dt>商品名</dt><dd>{candidate.brandName}</dd></div>
                <div><dt>规格</dt><dd>{candidate.specification}</dd></div>
                <div><dt>剂型</dt><dd>{candidate.form}</dd></div>
                <div><dt>生产厂家</dt><dd>{candidate.manufacturer}</dd></div>
                <div><dt>批准文号</dt><dd>{candidate.approval}</dd></div>
              </dl>
              <div className="safety-box"><AlertTriangle size={19} /><p>请对照手中包装逐项核对。识别结果不能作为服药依据。</p></div>
              <label className="check-line"><input type="checkbox" defaultChecked />以上信息与我手中的完整包装一致</label>
              <div className="button-row"><button className="secondary" onClick={onReset}><X size={18} />信息不符</button><button className="primary" onClick={onConfirm}><Check size={18} />确认并加入药箱</button></div>
            </div>
          </div>
        )}
      </div>
      <aside className="guide-card">
        <span className="guide-number">01</span><h3>拍摄小提示</h3>
        <ul><li><Check size={16} />药盒边缘完整入镜</li><li><Check size={16} />药名与规格文字清晰</li><li><Check size={16} />关闭闪光灯避免反光</li><li><Check size={16} />不要上传散装药片</li></ul>
        <div className="mock-label"><Sparkles size={18} /><div><strong>Qwen3-VL-Flash 已接入</strong><span>识别后与本地 Mock 药品库匹配</span></div></div>
      </aside>
    </section>
  )
}

function ConsultPage({
  drug,
  messages,
  question,
  listening,
  onQuestion,
  onAsk,
  onVoice,
  onSpeak,
}: {
  drug?: Drug
  messages: ChatMessage[]
  question: string
  listening: boolean
  onQuestion: (value: string) => void
  onAsk: (value?: string) => void
  onVoice: () => void
  onSpeak: (text: string) => void
}) {
  return (
    <section className="consult-layout">
      <div className="chat-panel">
        <div className="chat-header">
          <div className="ai-avatar"><Sparkles size={22} /></div>
          <div><h3>安心 AI 药师助手 <span>Mock</span></h3><p>{drug ? `正在咨询：${drug.genericName}` : '请先确认药品后再咨询'}</p></div>
        </div>
        <div className="chat-messages">
          {messages.map((message) => (
            <div className={`message ${message.role} ${message.urgent ? 'urgent' : ''}`} key={message.id}>
              {message.role === 'assistant' && <div className="mini-avatar"><Bot size={17} /></div>}
              <div className="bubble">
                {message.urgent && <strong className="urgent-title"><AlertTriangle size={18} />紧急风险提示</strong>}
                {message.sections ? (
                  <div className="answer-structured">
                    <div className="answer-summary"><span>简明结论</span><strong>{message.sections.summary}</strong></div>
                    {message.sections.keyPoints.length > 0 && (
                      <div className="answer-section">
                        <h4><Info size={16} />需要知道</h4>
                        <ul>{message.sections.keyPoints.map((item) => <li key={item}>{item}</li>)}</ul>
                      </div>
                    )}
                    {message.sections.risks.length > 0 && (
                      <div className="answer-section risk">
                        <h4><AlertTriangle size={16} />注意风险</h4>
                        <ul>{message.sections.risks.map((item) => <li key={item}>{item}</li>)}</ul>
                      </div>
                    )}
                    <div className="next-action"><ChevronRight size={17} /><div><span>下一步</span><strong>{message.sections.nextAction}</strong></div></div>
                    <p className="answer-warning"><ShieldCheck size={15} />{message.sections.warning}</p>
                  </div>
                ) : <p>{message.text}</p>}
                {message.role === 'assistant' && message.id !== 'welcome' && (
                  <div className="answer-meta">
                    <button onClick={() => onSpeak(message.sections ? `${message.sections.summary}。${message.sections.nextAction}。${message.sections.warning}` : message.text)}><Volume2 size={16} />播报摘要</button>
                    <span>来源：{message.citations?.join('；') || 'AI 回答 · 演示版'}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="quick-questions">{quickQuestions.map((item) => <button key={item} onClick={() => onAsk(item)}>{item}</button>)}</div>
        <div className="composer">
          <button className={listening ? 'mic listening' : 'mic'} onClick={onVoice} aria-label="语音输入">{listening ? <Square size={19} /> : <Mic size={20} />}</button>
          <textarea value={question} onChange={(event) => onQuestion(event.target.value)} placeholder={listening ? '正在听，请说出问题…' : '输入关于已确认药品的问题…'} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onAsk() } }} />
          <button className="send" onClick={() => onAsk()} aria-label="发送"><Send size={20} /></button>
        </div>
        <p className="composer-note">AI 仅作信息解释，不诊断、不处方、不建议自行调整剂量。</p>
      </div>
      <aside className="consult-side">
        <div className="boundary-card"><ShieldCheck size={23} /><h3>我能帮你</h3><ul><li>解释说明书字段</li><li>说明常见注意事项</li><li>提供储存方式信息</li></ul></div>
        <div className="boundary-card warn"><AlertTriangle size={23} /><h3>我不会做</h3><ul><li>诊断疾病或开处方</li><li>建议停药、换药或改剂量</li><li>替代医生处理急症</li></ul></div>
      </aside>
    </section>
  )
}

function ProfilePage({ onReset }: { onReset: () => void }) {
  return (
    <section>
      <div className="profile-card">
        <div className="profile-avatar">安</div><div><h2>演示用户</h2><p>数据仅保存在此浏览器</p></div><span>本地模式</span>
      </div>
      <div className="settings-list">
        <button><span><Bell size={20} />提醒设置</span><ChevronRight size={19} /></button>
        <button><span><ShieldCheck size={20} />隐私与数据</span><ChevronRight size={19} /></button>
        <button><span><History size={20} />服药历史</span><ChevronRight size={19} /></button>
        <button className="reset" onClick={onReset}><span><RotateCcw size={20} />恢复演示数据</span><ChevronRight size={19} /></button>
      </div>
      <div className="disclaimer"><AlertTriangle size={21} /><div><strong>仅供产品测试</strong><p>本 Demo 使用 Mock 药品与 Mock AI 回答，不用于真实诊疗、处方或用药决策。请使用测试图片和虚构健康资料。</p></div></div>
    </section>
  )
}

function PlanModal({ drug, onClose, onSave }: { drug: Drug; onClose: () => void; onSave: (data: { dose: string; time: string; meal: string }) => void }) {
  const [dose, setDose] = useState('1')
  const [time, setTime] = useState(new Date(Date.now() + 60_000).toTimeString().slice(0, 5))
  const [meal, setMeal] = useState('饭后')
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <button className="modal-close" onClick={onClose}><X size={21} /></button>
        <span className="eyebrow">NEW MEDICATION PLAN</span><h2>创建服药计划</h2><p className="modal-subtitle">请严格按照医生处方或药师指导填写。</p>
        <div className="selected-drug"><span><Pill size={22} /></span><div><strong>{drug.genericName}</strong><small>{drug.specification}</small></div></div>
        <div className="form-grid">
          <label>每次用量<div className="input-suffix"><input type="number" min="0.5" step="0.5" value={dose} onChange={(event) => setDose(event.target.value)} /><span>片</span></div></label>
          <label>提醒时间<input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>
          <label className="full">服药要求<select value={meal} onChange={(event) => setMeal(event.target.value)}><option>饭后</option><option>饭前</option><option>随餐</option><option>无特殊要求</option></select></label>
        </div>
        <label className="check-line"><input type="checkbox" defaultChecked />此用量来自处方、说明书或药师指导</label>
        <button className="primary full-button" onClick={() => onSave({ dose, time, meal })}>确认创建计划</button>
      </div>
    </div>
  )
}

function ReminderModal({ drug, task, onClose, onUpdate, onSpeak }: { drug: Drug; task: Plan; onClose: () => void; onUpdate: (status: TaskStatus) => void; onSpeak: (text: string) => void }) {
  return (
    <div className="modal-backdrop">
      <div className="modal reminder-modal">
        <button className="modal-close" onClick={onClose}><X size={21} /></button>
        <div className="bell-pulse"><Bell size={30} /></div><span className="eyebrow">MEDICATION REMINDER</span><h2>{task.status === 'pending' ? '该服药了' : '本次记录'}</h2>
        <div className="reminder-drug"><div className="drug-symbol"><Pill size={28} /></div><div><strong>{drug.genericName}</strong><p>{drug.specification} · {task.dose} 片 · {task.meal}</p></div></div>
        <button className="listen-button" onClick={() => onSpeak(`服药提醒，${drug.genericName}，本次${task.dose}片，${task.meal}`)}><Volume2 size={18} />播报提醒</button>
        {task.status === 'pending' ? (
          <><button className="primary full-button" onClick={() => onUpdate('taken')}><Check size={19} />确认已服</button><div className="button-row"><button className="secondary" onClick={() => onUpdate('later')}><Clock3 size={18} />稍后提醒</button><button className="secondary" onClick={() => onUpdate('skipped')}><Pause size={18} />跳过</button></div></>
        ) : (
          <><div className="record-result"><Check size={22} /><div><strong>{task.status === 'taken' ? '已记录服药' : task.status === 'skipped' ? '已记录跳过' : '已设置稍后提醒'}</strong><span>{task.updatedAt ? new Date(task.updatedAt).toLocaleString('zh-CN') : ''}</span></div></div><button className="secondary full-button" onClick={onClose}>关闭</button></>
        )}
        <p className="safety-foot">记录来自你的操作，不代表系统已医学验证实际服药。</p>
      </div>
    </div>
  )
}

export default App
