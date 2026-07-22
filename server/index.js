import 'dotenv/config'
import express from 'express'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const app = express()
const port = Number(process.env.PORT || 8787)
const __dirname = dirname(fileURLToPath(import.meta.url))
const staticDir = join(__dirname, '..', 'dist')

app.use(express.json({ limit: '22mb' }))

const mockDrugs = [
  {
    id: 'mock-amlodipine-5',
    genericName: '苯磺酸氨氯地平片',
    brandName: '络活喜（演示数据）',
    specification: '5 mg × 7片',
    form: '片剂',
    manufacturer: '辉瑞制药有限公司',
    approval: '国药准字H10950224',
    stock: 28,
    expiry: '2027-12-31',
  },
  {
    id: 'mock-cefuroxime-axetil-025',
    genericName: '头孢呋辛酯片',
    brandName: '达力新（演示数据）',
    specification: '0.25 g × 12片',
    form: '片剂',
    manufacturer: '国药集团致君（深圳）制药有限公司',
    approval: '包装正面未显示，待核对',
    stock: 12,
    expiry: '待录入',
  },
]

const emergencyPattern = /胸痛|呼吸困难|意识异常|昏迷|抽搐|大量误服|儿童误服|严重过敏|喉头紧缩|呕血|黑便|大量出血|自杀|自伤/
const prohibitedPattern = /停药|换药|增量|减量|加量|改剂量|改成.*片|应该吃几片|能吃几片/
const dosageOutputPattern =
  /一日\s*[\d.]+|每天\s*[\d.]+|每次\s*[\d.]+|分\s*\d+\s*次|[\d.]+\s*(?:mg|g|毫克|克|片|粒).{0,8}(?:一日|每天|每次|服用)|建议.{0,6}(?:服用|用量|剂量)/i

const drugProfiles = {
  'mock-amlodipine-5': {
    purpose: '常用于控制血压相关问题，需按医生处方使用。',
    storage: '密封、避光保存，放在儿童接触不到的地方。',
    risks: ['对成分过敏者禁用', '可能出现头晕、面部潮红等不适'],
    source: '本地 Mock 药品档案（演示数据，未经医学审核）',
  },
  'mock-cefuroxime-axetil-025': {
    purpose: '属于抗生素，通常用于敏感细菌引起的感染，对普通感冒等病毒感染无效。',
    storage: '按包装要求密封保存，避免受潮，放在儿童接触不到的地方。',
    risks: ['对头孢菌素类过敏者禁用', '可能出现恶心、腹泻等胃肠道不适'],
    source: '本地 Mock 药品档案（演示数据，未经医学审核）',
  },
}

function cleanBaseUrl(value, fallback) {
  return (value || fallback).replace(/\/+$/, '')
}

function sanitizeText(text) {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\^\[\d+\]\^/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/#{1,6}\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function containsDosageAdvice(text) {
  return dosageOutputPattern.test(String(text || ''))
}

function stripDosageAdvice(text) {
  if (!containsDosageAdvice(text)) return sanitizeText(text)
  return sanitizeText(text).replace(/[^。！？]*?(?:一日|每天|每次|分\s*\d+\s*次|mg|g|片|粒)[^。！？]*[。！？]?/gi, '')
}

function safeJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) return extractPartialJson(cleaned)
    try {
      return JSON.parse(match[0])
    } catch {
      return extractPartialJson(cleaned)
    }
  }
}

function extractPartialJson(text) {
  const pick = (key) => {
    const match = text.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`))
    return match ? sanitizeText(match[1]) : ''
  }
  const pickArray = (key) => {
    const match = text.match(new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]*)\\]`))
    if (!match) return []
    return [...match[1].matchAll(/"([^"]*)"/g)].map((item) => sanitizeText(item[1])).filter(Boolean)
  }
  const summary = pick('summary')
  if (!summary) return null
  return {
    summary,
    keyPoints: pickArray('keyPoints'),
    risks: pickArray('risks'),
    nextAction: pick('nextAction'),
    warning: pick('warning'),
  }
}

function normalizeSections(raw, drug) {
  const profile = drugProfiles[drug.id] || {}
  const summary = stripDosageAdvice(raw?.summary)
  const keyPoints = (Array.isArray(raw?.keyPoints) ? raw.keyPoints : [])
    .slice(0, 3)
    .map(stripDosageAdvice)
    .filter(Boolean)
  const risks = (Array.isArray(raw?.risks) ? raw.risks : [])
    .slice(0, 3)
    .map(sanitizeText)
    .filter(Boolean)
  const nextAction = sanitizeText(raw?.nextAction || '如有疑问，请咨询医生或药师。')
  const warning = sanitizeText(raw?.warning || '不要根据 AI 回答自行调整处方。')
  const limited = [summary, ...keyPoints, nextAction].some(containsDosageAdvice)

  return {
    summary: summary || profile.purpose || '暂时无法给出确定结论，请查看药品说明书或咨询医生、药师。',
    keyPoints: keyPoints.length ? keyPoints : profile.purpose ? [profile.purpose] : [],
    risks: risks.length ? risks : profile.risks || [],
    nextAction: limited ? '具体用量和疗程请按医生处方或说明书执行。' : nextAction,
    warning,
    limited,
  }
}

function fallbackSections(question, drug) {
  const profile = drugProfiles[drug.id] || {}
  if (/保存|储存/.test(question)) {
    return normalizeSections(
      {
        summary: profile.storage || '请按包装和说明书要求保存。',
        keyPoints: ['避免受潮和阳光直射', '放在儿童接触不到的地方'],
        risks: ['过期或储存不当可能影响药品质量'],
        nextAction: '请核对你手中包装的储存说明。',
        warning: '不要根据 AI 回答自行调整处方。',
      },
      drug,
    )
  }
  if (/不良|副作用|反应/.test(question)) {
    return normalizeSections(
      {
        summary: '如出现明显不适，应尽快咨询医生或药师。',
        keyPoints: profile.risks || ['不同人反应可能不同'],
        risks: ['出现严重皮疹、呼吸困难或持续严重腹泻时应立即就医'],
        nextAction: '记录不适出现时间和程度，就医时告知医生。',
        warning: '不要根据 AI 回答自行停药或改剂量。',
      },
      drug,
    )
  }
  return normalizeSections(
    {
      summary: profile.purpose || `${drug.genericName} 的详细说明请查看说明书或咨询医生、药师。`,
      keyPoints: ['本回答仅用于演示药品资料解释', '不代表对你的诊断或个体用药建议'],
      risks: profile.risks || ['对药物成分过敏者需提前告知医生'],
      nextAction: '按处方使用，不要自行调整。',
      warning: '不要根据 AI 回答自行调整处方。',
    },
    drug,
  )
}

function buildConsultResponse(rawAnswer, question, drug) {
  const parsed = safeJson(rawAnswer)
  const sections = parsed ? normalizeSections(parsed, drug) : fallbackSections(question, drug)
  const citations = [drugProfiles[drug.id]?.source || '本地 Mock 药品档案'].filter(Boolean)

  if (sections.limited) {
    return {
      riskLevel: 'L2',
      status: 'limited',
      answer: sections.summary,
      sections: {
        summary: sections.summary,
        keyPoints: sections.keyPoints,
        risks: sections.risks,
        nextAction: sections.nextAction,
        warning: sections.warning,
      },
      citations,
      notice: '已过滤具体剂量建议。用量请按医生处方或说明书执行。',
    }
  }

  return {
    riskLevel: 'L1',
    status: 'answered',
    answer: sections.summary,
    sections: {
      summary: sections.summary,
      keyPoints: sections.keyPoints,
      risks: sections.risks,
      nextAction: sections.nextAction,
      warning: sections.warning,
    },
    citations,
  }
}

function normalize(value) {
  return String(value || '').replace(/\s|×|x|\*/gi, '').toLowerCase()
}

function matchDrug(extracted) {
  const candidates = mockDrugs.filter((drug) => {
    const nameMatches =
      normalize(extracted.genericName).includes(normalize(drug.genericName)) ||
      normalize(drug.genericName).includes(normalize(extracted.genericName))
    const extractedDose = normalize(extracted.specification).match(/\d+(?:\.\d+)?(?:mg|g)/)?.[0]
    const drugDose = normalize(drug.specification).match(/\d+(?:\.\d+)?(?:mg|g)/)?.[0]
    const specificationMatches = Boolean(extractedDose && drugDose && extractedDose === drugDose)
    const formMatches =
      !extracted.form || normalize(drug.form).includes(normalize(extracted.form)) || normalize(extracted.form).includes('片')
    return nameMatches && specificationMatches && formMatches
  })
  return candidates.length === 1 ? candidates[0] : null
}

async function chatCompletion({ baseUrl, apiKey, model, messages, temperature = 0.1 }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, temperature }),
    signal: AbortSignal.timeout(60_000),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const providerMessage = payload?.error?.message || payload?.message || `上游服务返回 ${response.status}`
    throw new Error(providerMessage)
  }
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型未返回有效内容')
  return content
}

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    qwenConfigured: Boolean(process.env.QWEN_API_KEY),
    baichuanConfigured: Boolean(process.env.BAICHUAN_API_KEY),
  })
})

app.post('/api/ocr', async (request, response) => {
  const { image } = request.body || {}
  if (!process.env.QWEN_API_KEY) return response.status(503).json({ error: '服务端未配置 QWEN_API_KEY' })
  if (typeof image !== 'string' || !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(image)) {
    return response.status(400).json({ error: '请上传 JPG、PNG 或 WebP 药盒图片' })
  }
  if (image.length > 21 * 1024 * 1024) return response.status(413).json({ error: '图片过大，请压缩到 15MB 以内' })

  try {
    const content = await chatCompletion({
      baseUrl: cleanBaseUrl(process.env.QWEN_BASE_URL, 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
      apiKey: process.env.QWEN_API_KEY,
      model: process.env.QWEN_VL_MODEL || 'qwen3-vl-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: image } },
            {
              type: 'text',
              text: '识别这张药品完整包装或说明书。只输出严格 JSON，不要 Markdown：{"genericName":"","brandName":"","specification":"","form":"","manufacturer":"","approval":"","quality":"high|low","qualityReason":""}。无法确认的字段留空；不要根据散装药片外观猜测药名。',
            },
          ],
        },
      ],
    })
    const extracted = safeJson(content)
    if (!extracted) return response.status(422).json({ error: 'OCR 返回格式无法解析，请重试' })
    const required = extracted.genericName && extracted.specification && extracted.form
    const match = required && extracted.quality !== 'low' ? matchDrug(extracted) : null

    response.json({
      extracted,
      match,
      status: match ? 'matched' : 'unmatched',
      message: match
        ? '已在 Mock 药品库中找到唯一匹配，请核对包装'
        : '无法可靠唯一匹配，请勿据此服药。请补拍完整包装或咨询药师。',
      source: 'Qwen3-VL-Flash + 本地 Mock 药品库',
    })
  } catch (error) {
    console.error('OCR request failed:', error instanceof Error ? error.message : error)
    response.status(502).json({ error: `OCR 服务调用失败：${error instanceof Error ? error.message : '未知错误'}` })
  }
})

app.post('/api/consult', async (request, response) => {
  const question = String(request.body?.question || '').trim()
  const drug = request.body?.drug
  if (!question) return response.status(400).json({ error: '请输入咨询问题' })
  if (!drug?.genericName) return response.status(400).json({ error: '请先选择经过确认的药品' })

  if (emergencyPattern.test(question)) {
    return response.json({
      riskLevel: 'L4',
      status: 'emergency',
      answer: '你描述的情况可能需要紧急处理。请立即拨打当地急救电话或尽快前往急诊，不要等待 AI 继续判断。请携带相关药品包装、说明书和已知服药量。',
      sections: {
        summary: '你描述的情况可能需要紧急处理。',
        keyPoints: [],
        risks: ['不要等待 AI 继续判断，也不要自行处理。'],
        nextAction: '请立即拨打当地急救电话或尽快前往急诊，并携带药品包装、说明书和已知服药量。',
        warning: '紧急情况下，AI 不能替代急救或专业医疗评估。',
      },
      citations: [],
    })
  }
  if (prohibitedPattern.test(question)) {
    return response.json({
      riskLevel: 'L3',
      status: 'refused',
      answer: '我不能根据当前信息建议你增减剂量、停药或换药。这类调整需要结合诊断、检查结果和完整用药情况，由开具处方的医生或药师判断。',
      sections: {
        summary: '我不能建议你自行增减剂量、停药或换药。',
        keyPoints: ['用药调整需要结合诊断、检查结果和完整用药情况。'],
        risks: ['自行调整可能导致治疗失败、不良反应或其他风险。'],
        nextAction: '请联系开具处方的医生或药师。',
        warning: '不要根据 AI 回答自行调整处方。',
      },
      citations: [],
    })
  }
  if (!process.env.BAICHUAN_API_KEY) return response.status(503).json({ error: '服务端未配置 BAICHUAN_API_KEY' })

  try {
    const rawAnswer = await chatCompletion({
      baseUrl: cleanBaseUrl(process.env.BAICHUAN_BASE_URL, 'https://api.baichuan-ai.com/v1'),
      apiKey: process.env.BAICHUAN_API_KEY,
      model: process.env.BAICHUAN_MODEL || 'Baichuan-M3-Plus',
      messages: [
        {
          role: 'user',
          content: `你是“安心用药”演示版药品资料解释助手。只围绕已确认药品回答用户问题。

硬性规则：
1. 只输出严格 JSON，禁止 Markdown、禁止 **粗体**、禁止 ^[1]^ 这类引用编号。
2. 总字数控制在 150-250 个汉字。
3. 不得给出具体剂量、频次、疗程数字，不得说“一日X片/每次X mg”。
4. 不得诊断、开处方、建议停换药。
5. 不要罗列与用户问题无关的全部适应症、病原体、罕见不良反应。
6. 不要结尾追问“是否需要我继续检索”。

JSON 格式：
{"summary":"一句话直接回答","keyPoints":["最多3条"],"risks":["最多3条"],"nextAction":"下一步建议","warning":"不要自行调整处方的提示"}

已确认药品：${drug.genericName}；规格：${drug.specification || '未提供'}；剂型：${drug.form || '未提供'}。
用户问题：${question}`,
        },
      ],
    })
    response.json(buildConsultResponse(rawAnswer, question, drug))
  } catch (error) {
    console.error('Consult request failed:', error instanceof Error ? error.message : error)
    response.status(502).json({ error: `百川服务调用失败：${error instanceof Error ? error.message : '未知错误'}` })
  }
})

app.use(express.static(staticDir))
app.get(/^\/(?!api).*/, (_request, response, next) => {
  // SPA 路由回退：非 /api 开头的请求统一返回 index.html
  response.sendFile(join(staticDir, 'index.html'), (error) => next(error))
})

app.use((error, _request, response, _next) => {
  if (error?.type === 'entity.too.large') return response.status(413).json({ error: '上传内容过大' })
  console.error(error)
  response.status(500).json({ error: '服务端处理失败' })
})

app.listen(port, () => {
  console.log(`API server ready at http://localhost:${port}`)
  console.log(`Static files served from ${staticDir}`)
})
