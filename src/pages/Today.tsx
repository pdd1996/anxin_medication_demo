import { Check, ChevronRight, Clock3, Pause, Pill, Volume2, Bell, PackageCheck, Sparkles, Camera, Info, X } from 'lucide-react'
import type { Drug, MedRecord, Plan, TaskStatus } from '../types'
import { isPlanActiveOn, todayStr } from '../lib'

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '待服用',
  taken: '已服',
  skipped: '已跳过',
  later: '稍后提醒',
}

export function TodayPage({
  drugs,
  plans,
  records,
  onScan,
  onConsult,
  onRemind,
  onEntry,
}: {
  drugs: Drug[]
  plans: Plan[]
  records: MedRecord[]
  onScan: () => void
  onConsult: () => void
  onRemind: (planId: string) => void
  onEntry: () => void
}) {
  const today = todayStr()
  const activePlans = plans.filter((plan) => isPlanActiveOn(plan, today))
  const totalSlots = activePlans.reduce((sum, plan) => sum + plan.times.length, 0)
  const takenSlots = records.filter((record) => record.date === today && record.status === 'taken').length
  const progress = totalSlots ? Math.round((takenSlots / totalSlots) * 100) : 0
  const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())

  return (
    <section className="page-grid">
      <div className="hero-card">
        <div>
          <span className="date-label">{date}</span>
          <h2>{totalSlots === 0 ? '把所有来源的药放进同一个药箱' : progress >= 100 ? '今天的用药已全部记录' : '按时用药，安心每一天'}</h2>
          <p>{totalSlots === 0 ? '拍一张处方笺，建档和计划一步完成。' : '所有提醒均来自你亲自确认的计划。'}</p>
        </div>
        <div className="progress-ring" style={{ '--progress': `${progress * 3.6}deg` } as React.CSSProperties}>
          <span>{progress}%</span><small>今日完成</small>
        </div>
      </div>

      {activePlans.length === 0 ? (
        <div className="empty-journey full-span">
          <div className="journey-icon"><PackageCheck size={34} /></div>
          <h3>{drugs.length > 0 ? '药品已在药箱，还差服药计划' : '还没有今日用药任务'}</h3>
          <p>{drugs.length > 0 ? '从药箱创建计划，或拍摄贴标药盒自动生成草稿。' : '完成录入后，可建立你的第一条服药计划。'}</p>
          <button className="primary" onClick={onEntry}>{drugs.length > 0 ? '拍照录入' : '开始录入'}<ChevronRight size={18} /></button>
        </div>
      ) : (
        <div className="task-list full-span">
          {activePlans.map((plan) => {
            const drug = drugs.find((d) => d.id === plan.drugId)
            const planRecords = records.filter((record) => record.date === today && record.planId === plan.id)
            const takenCount = planRecords.filter((record) => record.status === 'taken').length
            const nextPending = plan.times.find(
              (time) => !planRecords.some((record) => record.time === time && record.status !== 'later'),
            ) || plan.times.find((time) => !planRecords.some((record) => record.time === time))
            return (
              <article className="task-card" key={plan.id}>
                <div className="task-time"><Clock3 size={20} /><strong>{nextPending || plan.times[0]}</strong><span>下一时间点</span></div>
                <div className="drug-symbol"><Pill size={28} /></div>
                <div className="task-info">
                  <span className="status-chip">{takenCount}/{plan.times.length} 已服 · {plan.cycleType === 'open' ? '长期' : plan.cycleType === 'stock' ? '用完为止' : `疗程至 ${plan.endDate}`}</span>
                  <h3>{drug?.genericName || '未知药品'}</h3>
                  <p>{drug?.specification} · 每次 {plan.dose.value} {plan.dose.unit} · 每日 {plan.frequency} 次{plan.route ? ` · ${plan.route}` : ''}</p>
                  <div className="time-status-row">
                    {plan.times.map((time) => {
                      const record = planRecords.find((r) => r.time === time)
                      const status = (record?.status || 'pending') as TaskStatus
                      return (
                        <span key={time} className={`time-status ts-${status}`}>
                          {time}{status === 'taken' && <Check size={12} />}{status === 'later' && <Clock3 size={12} />}{status === 'skipped' && <Pause size={12} />}
                        </span>
                      )
                    })}
                  </div>
                </div>
                <button className="primary" onClick={() => onRemind(plan.id)}>处理提醒</button>
              </article>
            )
          })}
        </div>
      )}

      <button className="action-card mint" onClick={onEntry}>
        <span><Camera size={24} /></span><div><strong>拍照录入</strong><small>拍处方笺一步建档建计划 / 拍药品建档</small></div><ChevronRight size={20} />
      </button>
      <button className="action-card sand" onClick={onConsult}>
        <span><Sparkles size={24} /></span><div><strong>问问 AI</strong><small>说明书解释 · 药理机制 · 注意事项</small></div><ChevronRight size={20} />
      </button>

      <div className="notice-card full-span">
        <Info size={20} />
        <div><strong>网页提醒说明</strong><p>本 Demo 仅在页面打开时模拟提醒，关闭页面后不会发送系统通知。漏服不会自动建议补服。</p></div>
      </div>
    </section>
  )
}

export function ReminderModal({
  drug,
  plan,
  records,
  onClose,
  onUpdate,
  onSpeak,
}: {
  drug: Drug
  plan: Plan
  records: MedRecord[]
  onClose: () => void
  onUpdate: (planId: string, time: string, status: 'taken' | 'skipped' | 'later') => void
  onSpeak: (text: string) => void
}) {
  const today = todayStr()
  const planRecords = records.filter((record) => record.date === today && record.planId === plan.id)
  return (
    <div className="modal-backdrop">
      <div className="modal reminder-modal">
        <button className="modal-close" onClick={onClose}><X size={21} /></button>
        <div className="bell-pulse"><Bell size={30} /></div>
        <span className="eyebrow">MEDICATION REMINDER</span>
        <h2>该服药了</h2>
        <div className="reminder-drug">
          <div className="drug-symbol"><Pill size={28} /></div>
          <div>
            <strong>{drug.genericName}</strong>
            <p>{drug.specification} · 每次 {plan.dose.value} {plan.dose.unit} · {plan.meal}{plan.route ? ` · ${plan.route}` : ''}</p>
          </div>
        </div>
        <div className="time-status-row modal-times">
          {plan.times.map((time) => {
            const record = planRecords.find((r) => r.time === time)
            const status = record?.status || 'pending'
            return (
              <button
                key={time}
                className={`time-status ts-${status} selectable`}
                onClick={() => onUpdate(plan.id, time, status === 'pending' ? 'taken' : status)}
                title={STATUS_LABEL[status as TaskStatus]}
              >
                {time}
              </button>
            )
          })}
        </div>
        <button
          className="listen-button"
          onClick={() => onSpeak(`服药提醒，${drug.genericName}，每次${plan.dose.value}${plan.dose.unit}，每日${plan.frequency}次`)}
        >
          <Volume2 size={18} />播报提醒
        </button>
        <button
          className="primary full-button"
          onClick={() => {
            const next = plan.times.find((time) => !planRecords.some((r) => r.time === time && r.status !== 'later')) || plan.times[0]
            onUpdate(plan.id, next, 'taken')
          }}
        >
          <Check size={19} />确认已服（下一时间点）
        </button>
        <div className="button-row">
          <button
            className="secondary"
            onClick={() => {
              const next = plan.times.find((time) => !planRecords.some((r) => r.time === time)) || plan.times[0]
              onUpdate(plan.id, next, 'later')
            }}
          >
            <Clock3 size={18} />稍后提醒
          </button>
          <button
            className="secondary"
            onClick={() => {
              const next = plan.times.find((time) => !planRecords.some((r) => r.time === time)) || plan.times[0]
              onUpdate(plan.id, next, 'skipped')
            }}
          >
            <Pause size={18} />跳过
          </button>
        </div>
        <p className="safety-foot">记录来自你的操作，不代表系统已医学验证实际服药；库存按次扣减。</p>
      </div>
    </div>
  )
}
