import { useState } from 'react'
import { AlertTriangle, ChevronRight, FileText, History, Plus, RotateCcw, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import type { HealthEntry, SourceRecord } from '../types'

const HEALTH_FIELDS = ['性别', '年龄', '出生年月', '过敏史', '特殊状态', '紧急联系人', '诊断']

export function ProfilePage({
  health,
  sources,
  onAddHealth,
  onDeleteHealth,
  onReset,
}: {
  health: HealthEntry[]
  sources: SourceRecord[]
  onAddHealth: (field: string, value: string) => void
  onDeleteHealth: (id: string) => void
  onReset: () => void
}) {
  const [field, setField] = useState(HEALTH_FIELDS[0])
  const [value, setValue] = useState('')

  return (
    <section>
      <div className="profile-card">
        <div className="profile-avatar">安</div>
        <div><h2>演示用户</h2><p>本地模拟用户 · 数据仅保存在此浏览器</p></div>
        <span>本地模式</span>
      </div>

      <div className="section-heading compact">
        <div><span className="eyebrow">HEALTH PROFILE</span><h2>健康信息</h2><p>两条入口一道闸门：手动填写或处方笺建议填入（勾选才写入），字段级来源标注</p></div>
      </div>
      <div className="health-panel">
        {health.length === 0 ? (
          <p className="muted-small">暂无健康信息——非必填，可跳过。处方笺识别出的诊断/性别/年龄会以「建议填入」形式出现在确认页。</p>
        ) : (
          <div className="health-list">
            {health.map((entry) => (
              <div key={entry.id} className="health-row">
                <UserRound size={16} />
                <strong>{entry.field}</strong>
                <span>{entry.value}</span>
                <em className={`source-tag st-${entry.source}`}>
                  {entry.source === 'user' ? '用户自述' : '处方笺抄录 · 已确认'}
                </em>
                <button aria-label="删除" onClick={() => onDeleteHealth(entry.id)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="health-add">
          <select value={field} onChange={(event) => setField(event.target.value)}>
            {HEALTH_FIELDS.map((item) => <option key={item}>{item}</option>)}
          </select>
          <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="填写内容（将标注为用户自述）" />
          <button
            className="secondary"
            disabled={!value.trim()}
            onClick={() => {
              onAddHealth(field, value.trim())
              setValue('')
            }}
          >
            <Plus size={16} />添加
          </button>
        </div>
        <p className="muted-small">产品不做诊断：「诊断」字段语义永远为「用户报告的诊断」，AI 将其视为用户提供的、未经医学验证的信息。</p>
      </div>

      <div className="section-heading compact">
        <div><span className="eyebrow">AUDIT TRAIL</span><h2>来源与确认留痕</h2><p>每个档案和计划从哪来：确认时间、确认方式、关键字段快照（三层追溯锚点）</p></div>
      </div>
      <div className="sources-panel">
        {sources.length === 0 ? (
          <p className="muted-small">暂无来源记录。录入确认后，这里会记录来源凭证与确认动作。</p>
        ) : (
          [...sources].reverse().map((source) => (
            <div key={source.id} className="source-record">
              <div className="source-head">
                <FileText size={16} />
                <strong>{source.kind}</strong>
                {source.hospital && <span>{source.hospital}</span>}
                {source.rxNo && <span>处方号 {source.rxNo}</span>}
                {source.date && <span>{source.date}</span>}
                <em>{source.confirmMethod} · {new Date(source.confirmedAt).toLocaleString('zh-CN')}</em>
              </div>
              <div className="source-snapshot">
                {Object.entries(source.keySnapshot).map(([key, val]) => (
                  <span key={key}><dt>{key}</dt><dd>{val}</dd></span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="settings-list">
        <button><span><ShieldCheck size={20} />隐私与数据</span><ChevronRight size={19} /></button>
        <button><span><History size={20} />服药历史</span><ChevronRight size={19} /></button>
        <button className="reset" onClick={onReset}><span><RotateCcw size={20} />恢复演示数据</span><ChevronRight size={19} /></button>
      </div>
      <div className="disclaimer"><AlertTriangle size={21} /><div><strong>仅供产品测试</strong><p>本 Demo 使用 Mock 药品与说明书数据（演示抄录，未经医学审核），不用于真实诊疗、处方或用药决策。请使用测试图片和虚构健康资料。</p></div></div>
    </section>
  )
}
