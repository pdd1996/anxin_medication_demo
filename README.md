# 安心用药 Demo

> 「安心用药」MVP 演示版本 —— AI 赋能慢病管理、智能识药、用药提醒与风险干预一体化平台的前端 Demo。

本 Demo 用于在真实临床与家庭场景推广前，验证**拍照识药、个人药箱、服药计划与提醒、AI 用药咨询**等核心功能与安全规则。Demo 使用 Mock 药品数据，所有数据仅保存在本机浏览器，**不用于真实诊疗、处方或用药决策**。

---

## 一、产品定位

面向慢病及多药患者的居家用药场景，通过药盒拍照识药、个人药箱、服药计划与提醒、服药记录、AI 用药咨询、语音交互等功能，帮助慢病患者和老年人降低漏服、重复服药、药品过期及错误理解说明书等风险。

**安全优先**是本产品坚守的原则：

- 宁可无法识别，也不猜测药品；
- 识别结果必须经用户确认；
- AI 只基于已确认信息与权威资料回答；
- 不自动诊断、开药、换药、停药或调整剂量；
- 高风险场景优先引导医生、药师或急救。

把「会拒答」作为产品能力而非缺陷，在「可用」与「安全」之间优先守住安全边界。

---

## 二、功能概览

Demo 提供两个独立端：患者端（5 个核心页面）与医生端（患者洞察 Agent），覆盖「识药 -> 建档 -> 计划 -> 提醒 -> 咨询」与「患者数据 -> 工具分析 -> 诊前摘要」闭环：

### 患者端（`/`）

| 页面 | 名称 | 功能说明 |
| :-: | :-: | :-- |
| 🏠 | 用药 | 今日用药任务、完成进度环、服药提醒入口 |
| 📦 | 药箱 | 仅展示用户确认过的药品，支持创建/编辑计划、删除 |
| 📷 | 识药 | 拍照上传药盒，OCR 提取字段并与本地 Mock 药品库匹配，用户确认后入箱 |
| 🤖 | AI 咨询 | 基于已确认药品的结构化问答，支持语音输入与播报 |
| 👤 | 我的 | 演示用户信息、设置入口、恢复演示数据 |

### 医生端 · 患者洞察（`/doctor/insight`）

独立路由，不出现在患者端导航。详见 `docs/04-患者洞察Agent方案设计.md`。

- 患者列表：8 名 Mock 患者，覆盖高/中/低依从性、相互作用、临期、风险事件场景
- 单患者诊前摘要：Agent 调用 5 个只读工具（依从性/用药清单/相互作用/临期库存/风险事件），再由百川 LLM 组装摘要并过安全守门
- 数据快照：每份摘要带生成时间、数据区间、工具链，可追溯

### 安全规则体系

服务端在 `/api/consult` 与 `/api/insight/*` 中内置同一套多层风险拦截：

- **L4 紧急**：命中「胸痛、呼吸困难、昏迷、抽搐、儿童误服」等关键词时，立即引导拨打急救电话；
- **L3 拒答**：命中「停药、换药、增量、减量、改剂量」等关键词时，引导联系开方医生或药师；
- **L2 受限**：检测到模型输出含具体剂量建议时，自动过滤并提示「用量请按处方或说明书执行」；
- **L1 正常**：常规说明书解释、注意事项、储存方式等。

---

## 三、技术栈

| 层级 | 技术 | 说明 |
| :-: | :-: | :-- |
| 前端 | React 18 + TypeScript | 单页应用，`src/App.tsx` 集中实现全部页面与组件 |
| 构建 | Vite 5 | 开发服务器与生产构建，端口 5173 |
| 图标 | lucide-react | 统一的线性图标库 |
| 后端 | Node.js + Express 5 | API 服务，端口 8787 |
| OCR | 阿里云百炼 · Qwen3-VL-Flash | 药盒/说明书图像识别 |
| 咨询 | 百川智能 · Baichuan-M3-Plus | 药品资料解释（医学领域模型） |
| 数据 | localStorage | 演示数据仅保存在本机浏览器 |

---

## 四、目录结构

```
demo/
├── .env.example          # 环境变量模板（含 Qwen / 百川配置）
├── .gitignore
├── index.html            # Vite 入口 HTML
├── package.json          # 依赖与脚本
├── tsconfig.json         # TypeScript 配置
├── tsconfig.node.json    # Node 端 TS 配置
├── vite.config.ts       # Vite 配置（含 /api 代理到 8787）
├── src/
│   ├── main.tsx          # React 挂载入口
│   ├── App.tsx           # 应用主组件（患者端 + 医生端 /doctor 路由分流）
│   └── styles.css        # 全局样式
├── server/
│   ├── index.js          # Express API（/api/health、/api/ocr、/api/consult、/api/insight）
│   └── mock-data.json    # 患者洞察 Mock 数据（药品/相互作用/患者画像）
├── dist/                 # 构建产物（git 忽略）
└── node_modules/         # 依赖（git 忽略）
```

---

## 五、快速开始

### 1. 环境要求

- Node.js ≥ 18（推荐 20 LTS）
- npm ≥ 9

### 2. 安装依赖

```bash
cd demo
npm install
```

### 3. 配置环境变量

复制模板并填写 API Key：

```bash
cp .env.example .env
```

编辑 `.env`：

```dotenv
# 阿里云百炼（用于 OCR 识药）
QWEN_API_KEY=你的阿里云百炼Key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_VL_MODEL=qwen3-vl-flash

# 百川智能（用于 AI 用药咨询）
BAICHUAN_API_KEY=你的百川Key
BAICHUAN_BASE_URL=https://api.baichuan-ai.com/v1
BAICHUAN_MODEL=Baichuan-M3-Plus

PORT=8787
```

> 未配置对应 Key 时，相关接口会返回 `503`，但前端药箱、计划、提醒等本地功能不受影响。

### 4. 启动开发服务

```bash
npm run dev
```

该命令会通过 `concurrently` 同时启动：

- **API 服务**：`http://localhost:8787`（`node --watch` 热重启）
- **Web 服务**：`http://localhost:5173`（Vite HMR）

浏览器打开 `http://localhost:5173` 即可体验。Vite 已配置 `/api` 代理到后端，前端无需关心跨域。

### 5. 生产构建与预览

```bash
npm run build      # tsc -b && vite build，产物输出到 dist/
npm run preview    # 本地预览构建产物（仅前端）
npm start          # 启动生产 API 服务（需自行托管 dist 静态资源）
```

---

## 六、脚本说明

| 命令 | 作用 |
| :-- | :-- |
| `npm run dev` | 同时启动 API + Web 开发服务（推荐） |
| `npm run dev:web` | 仅启动前端 Vite 开发服务器 |
| `npm run dev:server` | 仅启动后端 API（文件变更自动重启） |
| `npm start` | 生产模式启动后端 API |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run preview` | 预览构建产物 |

---

## 七、API 接口

### `GET /api/health`

健康检查，返回服务状态与各 AI 服务配置情况。

```json
{
  "ok": true,
  "qwenConfigured": true,
  "baichuanConfigured": false
}
```

### `POST /api/ocr`

上传药盒图片进行识别。

- **请求体**：`{ "image": "data:image/jpeg;base64,..." }`（支持 JPG / PNG / WebP，≤ 21MB）
- **响应**：提取的药品字段 + 与本地 Mock 药品库的匹配结果

```json
{
  "extracted": { "genericName": "苯磺酸氨氯地平片", "specification": "5 mg", "form": "片剂", ... },
  "match": { "id": "mock-amlodipine-5", ... },
  "status": "matched",
  "message": "已在 Mock 药品库中找到唯一匹配，请核对包装",
  "source": "Qwen3-VL-Flash + 本地 Mock 药品库"
}
```

### `POST /api/consult`

基于已确认药品进行 AI 咨询，内置风险分级与剂量过滤。

- **请求体**：`{ "question": "这个药通常用于什么？", "drug": { "genericName": "...", ... } }`
- **响应**：结构化回答（summary / keyPoints / risks / nextAction / warning）+ `riskLevel`（L1~L4）

### `GET /api/insight/patients`

医生端患者洞察 · 返回 Mock 患者列表（不含明细）。

- **响应**：`{ "ok": true, "patients": [{ "id", "name", "age", "gender", "conditions", "drugCount", "enrolledAt", "lastActiveAt" }] }`

### `POST /api/insight/summary`

医生端患者洞察 · 生成某患者诊前摘要。编排 Agent 串行调用 5 个只读工具（依从性/用药清单/相互作用/临期库存/风险事件），把工具输出交给百川 LLM 组装摘要，再过安全守门 `guardSummary`（L1~L4）。未配置 `BAICHUAN_API_KEY` 时降级为规则拼接的确定性摘要。

- **请求体**：`{ "patientId": "p-001" }`
- **响应**：`{ "patient", "riskLevel", "sections", "tools", "snapshot": { "generatedAt", "dateRange", "toolChain", "mode" }, "citations" }`
- 详见 `docs/04-患者洞察Agent方案设计.md`

---

## 八、Mock 药品库

### OCR 匹配库

Demo 内置两条演示药品数据，OCR 识别后会与之匹配：

| ID | 通用名 | 商品名 | 规格 |
| :-- | :-- | :-- | :-- |
| `mock-amlodipine-5` | 苯磺酸氨氯地平片 | 络活喜（演示数据） | 5 mg × 7片 |
| `mock-cefuroxime-axetil-025` | 头孢呋辛酯片 | 达力新（演示数据） | 0.25 g × 12片 |

匹配逻辑见 `server/index.js` 中的 `matchDrug()`：综合比对通用名、规格剂量与剂型，仅当唯一匹配时才返回结果，否则提示「无法可靠唯一匹配」。

### 患者洞察 Mock 数据

医生端洞察的药品目录（6 种）、相互作用规则、患者画像（8 名）集中存放在 `server/mock-data.json`，与代码分离。患者的服药记录由 `recordPresets`（`rate` 执行率 + `tailSkip` 末尾连续漏服天数）在服务端启动时展开，调整依从性只需改 JSON 一个数字。详见 `docs/04-患者洞察Agent方案设计.md` 第 2.3 节。

---

## 九、数据与隐私

- 所有演示数据（药品、计划、聊天记录）保存在浏览器 `localStorage`，**不上传服务器、不持久化到数据库**；
- 上传的药盒图片以 Base64 形式直传后端调用 OCR，**不在服务端留存**；
- 「我的 → 恢复演示数据」可一键清空本地数据；
- `.env` 已在 `.gitignore` 中忽略，不会提交 API Key。

---

## 十、使用建议

- 识药时请上传**完整、清晰**的药盒正面或说明书，避免反光、遮挡和过暗；**不要上传散装药片**，模型无法可靠识别；
- OCR 返回结果后，请**对照手中包装逐项核对**再确认入箱，识别结果不能作为服药依据；
- AI 咨询仅作说明书信息解释，涉及诊断、停换药或剂量调整时请咨询医生或药师；
- 语音输入依赖浏览器的 `SpeechRecognition`，语音播报依赖 `speechSynthesis`，建议使用 Chrome / Edge 等现代浏览器。

---

## 十一、免责声明

本 Demo 使用 **Mock 药品数据与 Mock / 真实 AI 回答**，仅用于产品功能与安全规则验证，**不用于真实诊疗、处方或用药决策**。请使用测试图片和虚构健康资料进行体验。任何健康相关问题请以医生或药师的专业意见为准。
