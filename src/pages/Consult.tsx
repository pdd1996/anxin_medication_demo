import { AlertTriangle, Bot, ChevronRight, Info, Mic, Send, ShieldCheck, Sparkles, Square, Volume2, X } from 'lucide-react'
import type { ChatMessage, Drug } from '../types'
import { CONFIRM_STATUS_META } from '../lib'

const quickQuestions = [
  '这个药通常用于什么？',
  '常见不良反应有哪些？',
  '这个药是怎么起作用的？（药理机制）',
  '这个药应该怎么保存？',
]

export function ConsultPage({
  drugs,
  selectedDrugId,
  messages,
  question,
  listening,
  consultLoading,
  onSelectedDrug,
  onQuestion,
  onAsk,
  onVoice,
  onSpeak,
}: {
  drugs: Drug[]
  selectedDrugId: string | null
  messages: ChatMessage[]
  question: string
  listening: boolean
  consultLoading: boolean
  onSelectedDrug: (drugId: string) => void
  onQuestion: (value: string) => void
  onAsk: (value?: string) => void
  onVoice: () => void
  onSpeak: (text: string) => void
}) {
  const drug = drugs.find((d) => d.id === selectedDrugId) || drugs[0]
  const statusMeta = drug ? CONFIRM_STATUS_META[drug.confirmStatus] : null

  return (
    <section className="consult-layout">
      <div className="chat-panel">
        <div className="chat-header">
          <div className="ai-avatar"><Sparkles size={22} /></div>
          <div>
            <h3>安心 AI 药师助手 <span>Mock</span></h3>
            <p>{drug ? `正在咨询：${drug.genericName}` : '请先确认药品后再咨询'}</p>
          </div>
        </div>

        {drugs.length > 0 && (
          <div className="consult-drug-select">
            {drugs.map((item) => (
              <button
                key={item.id}
                className={`drug-chip ${item.id === drug?.id ? 'selected' : ''}`}
                onClick={() => onSelectedDrug(item.id)}
              >
                {item.genericName}
                <em className={`cs-dot cs-${item.confirmStatus}`} title={CONFIRM_STATUS_META[item.confirmStatus].label} />
              </button>
            ))}
          </div>
        )}
        {drug && statusMeta && (
          <div className={`consult-status cs-${drug.confirmStatus}`}>
            <ShieldCheck size={15} />
            <span>{statusMeta.label} —— {statusMeta.hint}</span>
          </div>
        )}
        {drug?.confirmStatus === 'manual' && (
          <div className="safety-box slim l0-box">
            <AlertTriangle size={17} />
            <p>该药品未经 OCR 确认：仅可做 L0 一般资料查询（不依赖身份可靠性的说明书解释），不可进入个体化用药解释。</p>
          </div>
        )}

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
                {message.notice && <p className="answer-notice"><Info size={14} />{message.notice}</p>}
                {message.l0Notice && <p className="answer-notice l0"><ShieldCheck size={14} />{message.l0Notice}</p>}
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
          <button className="send" onClick={() => onAsk()} disabled={consultLoading} aria-label="发送">{consultLoading ? <X size={20} className="spin" /> : <Send size={20} />}</button>
        </div>
        <p className="composer-note">AI 基于本地说明书库按键取数回答，不诊断、不处方、不建议自行调整剂量；不预测个体疗效。</p>
      </div>
      <aside className="consult-side">
        <div className="boundary-card"><ShieldCheck size={23} /><h3>我能帮你</h3><ul><li>解释说明书字段与药理机制</li><li>说明常见注意事项</li><li>提示生效计划中的相互作用</li></ul></div>
        <div className="boundary-card warn"><AlertTriangle size={23} /><h3>我不会做</h3><ul><li>诊断疾病或开处方</li><li>建议停药、换药或改剂量</li><li>预测“对你效果如何”</li><li>替代医生处理急症</li></ul></div>
      </aside>
    </section>
  )
}
