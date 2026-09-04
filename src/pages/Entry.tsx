import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  Check,
  FileText,
  ImagePlus,
  LoaderCircle,
  Package,
  RotateCcw,
  ScanLine,
  ShieldAlert,
  Sparkles,
  SwitchCamera,
  TriangleAlert,
} from 'lucide-react'
import type { ExtractResponse } from '../types'

export interface EntryState {
  step: 'pick' | 'upload' | 'processing' | 'warning' | 'error' | 'confirm'
  entry: 'A' | 'B'
  imageUrl: string
  image?: string
  demoSample?: string
  error?: string
  unsupported?: boolean
  payload?: ExtractResponse
}

export const ENTRY_SAMPLES: Record<'A' | 'B', { key: string; label: string; description: string }[]> = {
  A: [
    { key: 'rx-hycosan', label: '处方笺 · 海露（golden case）', description: '主线：医嘱抄录 + 唯一匹配 + 脱敏演示' },
    { key: 'rx-levofloxacin', label: '处方笺 · 左氧氟沙星滴眼液', description: '与已生效的海露计划命中相互作用' },
    { key: 'rx-spec-conflict', label: '处方笺 · 海露（多规格冲突）', description: '处方 0.1% vs 识别 0.2%，冲突暴露不裁决' },
    { key: 'box-labeled-hycosan', label: '贴标药盒 · 故意选错入口', description: '层检测纠偏：入口不符时提示确认或切换，不静默改道' },
  ],
  B: [
    { key: 'box-labeled-hycosan', label: '贴标药盒 · 海露', description: '标签抄录用法、疗程缺失三选一、滴数层间冲突' },
    { key: 'box-otc-hycosan', label: '自购药盒 · 海露', description: '仅身份线建档，计划手动创建' },
    { key: 'rx-hycosan', label: '处方笺 · 故意选错入口', description: '层检测纠偏：检测到处方层，建议切换到「拍处方笺」' },
  ],
}

const PIPELINE_STEPS = [
  '层检测 · 判定照片含有的信息层',
  '医嘱线 · OCR 转录（内存中）',
  '医嘱线 · 版面裁剪 + 白名单解析',
  '医嘱线 · 兜底脱敏扫描',
  '身份线 · VLM 提取身份字段',
  '身份线 · 药名+规格+剂型严格匹配',
  '草稿汇合 · 计划草稿 + 相互作用 + 范围校验',
]

const PIPELINE_STEPS_B = [
  '层检测 · 判定照片含有的信息层',
  '身份线 · VLM 提取身份字段（药盒层不提取用法用量）',
  '身份线 · 药名+规格+剂型严格匹配',
  '标签抄录 · 医院标签层用法用量（如有）',
  '草稿汇合 · 档案草稿 + 相互作用检查',
]

export function EntryPage({
  state,
  onPickEntry,
  onUpload,
  onDemoSample,
  onSwitchEntry,
  onContinueAnyway,
  onBackToUpload,
  onManual,
  onBackToPick,
}: {
  state: EntryState
  onPickEntry: (entry: 'A' | 'B') => void
  onUpload: (entry: 'A' | 'B', image: string, previewUrl: string) => void
  onDemoSample: (entry: 'A' | 'B', sample: string) => void
  onSwitchEntry: () => void
  onContinueAnyway: () => void
  onBackToUpload: () => void
  onManual: () => void
  onBackToPick: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const steps = state.entry === 'A' ? PIPELINE_STEPS : PIPELINE_STEPS_B

  useEffect(() => {
    if (state.step !== 'processing') {
      setStepIndex(0)
      return
    }
    const timer = window.setInterval(() => {
      setStepIndex((current) => Math.min(current + 1, steps.length - 1))
    }, 900)
    return () => window.clearInterval(timer)
  }, [state.step, steps.length])

  return (
    <section className="scan-layout">
      <div className="scan-main">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">CAPTURE &amp; EXTRACT</span>
            <h2>拍照录入</h2>
            <p>两个入口对应两种意图，层检测作为入口校验，不静默改道。</p>
          </div>
        </div>

        {state.step === 'pick' && (
          <div className="entry-cards">
            <button className="entry-card" onClick={() => onPickEntry('A')}>
              <span className="entry-icon"><FileText size={30} /></span>
              <strong>拍处方笺</strong>
              <small>入口 A · 医嘱录入</small>
              <p>把这次看病开的药安排上：建档和服药计划在同一个确认页完成，全程不需要手动输入医嘱字段。</p>
              <em>平铺完整 · 覆盖 Rp 至处方完毕</em>
            </button>
            <button className="entry-card" onClick={() => onPickEntry('B')}>
              <span className="entry-icon"><Package size={30} /></span>
              <strong>拍药品</strong>
              <small>入口 B · 药品建档</small>
              <p>我手里这个药，帮我建档管理：识别贴标药盒时一并抄录标签用法；自购 OTC 仅建档，计划手动创建。</p>
              <em>正面清晰 · 标签完整</em>
            </button>
          </div>
        )}

        {state.step === 'upload' && (
          <div className="upload-zone" onClick={() => fileRef.current?.click()}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => {
                  const dataUrl = String(reader.result)
                  onUpload(state.entry, dataUrl, dataUrl)
                }
                reader.readAsDataURL(file)
                event.target.value = ''
              }}
              hidden
            />
            <div className="camera-frame">
              <ImagePlus size={38} />
              <span className="corner c1" /><span className="corner c2" /><span className="corner c3" /><span className="corner c4" />
            </div>
            <h3>{state.entry === 'A' ? '上传平铺完整的处方笺照片' : '上传正面清晰的药盒照片'}</h3>
            <p>
              {state.entry === 'A'
                ? '覆盖 Rp（正文）至处方完毕，避免反光、遮挡和过暗'
                : '药盒正面完整入镜，医院标签清晰可读；散装药片无法识别'}
            </p>
            <button className="primary"><Camera size={19} />拍摄 / 选择照片</button>
            <small>上传即表示你了解图片可能包含个人健康信息；医嘱线在服务端完成白名单解析与四层脱敏，原文即用即弃。</small>
            <div className="sample-block" onClick={(event) => event.stopPropagation()}>
              <span className="sample-title"><Sparkles size={15} />演示样例（合成化 golden case，无需照片）</span>
              <div className="sample-buttons">
                {ENTRY_SAMPLES[state.entry].map((sample) => (
                  <button key={sample.key} className="sample-button" onClick={() => onDemoSample(state.entry, sample.key)}>
                    <strong>{sample.label}</strong>
                    <span>{sample.description}</span>
                  </button>
                ))}
              </div>
            </div>
            <button className="link-button" onClick={(event) => { event.stopPropagation(); onBackToPick() }}>← 换个入口</button>
          </div>
        )}

        {state.step === 'processing' && (
          <div className="processing">
            {state.imageUrl ? (
              <div className="preview"><img src={state.imageUrl} alt="待识别图片" /><div className="scan-line" /></div>
            ) : (
              <div className="preview preview-text"><ScanLine size={30} /><span>演示样例 · 合成化数据</span></div>
            )}
            <LoaderCircle className="spin" size={28} />
            <h3>{state.demoSample ? '正在运行双线提取管线（演示样例）' : '正在识别'}</h3>
            <ol className="pipeline-steps">
              {steps.map((step, index) => (
                <li key={step} className={index < stepIndex ? 'done' : index === stepIndex ? 'active' : ''}>
                  {index < stepIndex ? <Check size={15} /> : index === stepIndex ? <LoaderCircle className="spin" size={15} /> : <span className="step-dot" />}
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}

        {state.step === 'warning' && state.payload && (
          <div className="processing">
            <div className="journey-icon warn"><ShieldAlert size={34} /></div>
            <h3>检测结果与所选入口不符</h3>
            <p>{state.payload.layerWarning}</p>
            <div className="layer-chips">
              {state.payload.layers?.map((layer) => <span key={layer} className="chip">{layer}</span>)}
            </div>
            <p className="muted-small">层检测是校验而不是分流——系统不会静默改道，由你决定。</p>
            <div className="button-row">
              <button className="primary" onClick={onSwitchEntry}><SwitchCamera size={17} />切换入口重跑</button>
              <button className="secondary" onClick={onContinueAnyway}>按「{state.entry === 'A' ? '拍处方笺' : '拍药品'}」继续</button>
              <button className="secondary" onClick={onBackToUpload}><RotateCcw size={17} />重新上传</button>
            </div>
          </div>
        )}

        {state.step === 'error' && (
          <div className="processing">
            <div className="journey-icon warn"><AlertTriangle size={34} /></div>
            <h3>{state.unsupported ? '该对象暂不支持' : '无法可靠识别'}</h3>
            <p>{state.error}</p>
            <div className="safety-box"><AlertTriangle size={19} /><p>请勿根据本次结果服药或调整药物。所有失败分支都"看得见"：可重拍、可人工补、可手动建档兜底。</p></div>
            <div className="button-row">
              <button className="primary" onClick={onBackToUpload}><RotateCcw size={18} />重新上传</button>
              <button className="secondary" onClick={onManual}>手动建档（不经识别）</button>
              {state.unsupported && <button className="secondary" onClick={onBackToPick}>换个入口</button>}
            </div>
            {state.payload?.layers && (
              <p className="muted-small">
                <TriangleAlert size={13} /> 层检测：{state.payload.layers.join('、')}
              </p>
            )}
          </div>
        )}
      </div>

      <aside className="guide-card">
        <span className="guide-number">01</span>
        <h3>{state.entry === 'A' ? '处方笺拍摄要点' : '药盒拍摄要点'}</h3>
        <ul>
          {state.entry === 'A' ? (
            <>
              <li><Check size={16} />处方笺平铺完整入镜</li>
              <li><Check size={16} />覆盖 Rp 至「处方完毕」</li>
              <li><Check size={16} />关闭闪光灯避免反光</li>
              <li><Check size={16} />涂黑/遮挡字段按缺失处理，系统不猜测</li>
            </>
          ) : (
            <>
              <li><Check size={16} />药盒边缘完整入镜</li>
              <li><Check size={16} />药名与规格文字清晰</li>
              <li><Check size={16} />医院标签完整可读（如有）</li>
              <li><Check size={16} />不要上传散装药片</li>
            </>
          )}
        </ul>
        <div className="mock-label"><Sparkles size={18} /><div><strong>双线提取已接入</strong><span>医嘱线：OCR + 规则解析 · 身份线：VLM + 严格匹配</span></div></div>
        <div className="mock-label"><ShieldAlert size={18} /><div><strong>四层脱敏</strong><span>版面裁剪 / 白名单 / 兜底扫描 / 出口约束</span></div></div>
      </aside>
    </section>
  )
}
