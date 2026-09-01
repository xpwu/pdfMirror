# 本地论文翻译 Agent · 设计文档

> 版本：1.0（冻结版）
> 状态：**方案 100% 冻结，动手前不再修改结构**
> 目标：将「PDF 解析 → 本地模型翻译 → 分页对照阅读 → 多模型版本管理」集成到一个本地工具中，支持逐步扩展为 Agent。

---

## 0. 目标与非目标

### 0.1 目标

1. 本地管理多篇英文论文，按工作区组织。
2. 用本地模型（Ollama + Qwen 系列）将论文逐段翻译为中文。
3. 解析阶段保留**公式 / 表格 / 图片 / 图注 / 表注 / 参考文献**，这些内容**不翻译**。
4. 提供**左右对照阅读**界面：左=英文原文 PDF，右=中文译文。
5. 左右**按页对齐**，支持轻量手动微调，微调结果持久化。
6. 同一篇论文支持**多个模型版本**，可切换、可重新翻译。
7. 后端 = 内容服务（Go），前端 = Next.js + TypeScript + Tailwind，逐步扩展为 Agent。

### 0.2 非目标（明确不做）

- 不提供云端协作 / 多用户（纯本地个人工具）。
- 不做"自动判断翻译质量并重翻"的智能逻辑（P0；P2 再扩展）。
- 不自动创建任何用户数据目录（见铁律 L2）。

---

## 1. 核心原则 / 铁律

> 这些是不可违反的硬性约束，后续任何实现（含 Agent 扩展）都必须遵守。

| ID | 规则 | 说明 |
|----|------|------|
| **L1** | **英文根目录只读** | 后端绝不向英文根写入任何文件 / 文件夹 |
| **L2** | **中文根目录缺失 → 只报错，绝不自动创建** | 配置路径不存在 / 默认 `xxx_cn` 不存在，一律显示错误 |
| **L3** | **只允许写入中文根目录下的子文件夹** | 译文 / `_cache/` / `_workspace/` 都必须在中文根内 |
| L4 | 译文与原文**相对各自根目录路径相同、文件名相同**（PDF 主名同名） | 见 §3 |
| L5 | 所有翻译产物文件名**必须带 `_{模型/工具}` 后缀**（支持同文多模型） | 见 §3.3 |
| L6 | 中间产物文件夹**不使用隐藏目录**（不用 `.cache`，用 `_cache`） | 用户可见、可管理 |

---

## 2. 工作区模型

### 2.1 定义

> **英文根目录本身即一个工作区。** 不需要额外的工作区实体 / ID / 数据库表。

- 配置里列出一组**英文根目录路径**，每个路径就是一个工作区。
- 路径本机唯一，直接作为 key。
- 左侧目录树**一级 = 工作区**（即英文根目录）。

### 2.2 中文根定位规则（优先级）

```
对每个英文根 workspace = /path/to/xxx：

1. 用户在配置中显式配置了 translated_root？
   ├─ 是 → 使用该路径
   │       ├─ 路径存在  → ✅ 正常
   │       └─ 不存在    → ❌ 显示错误（不创建）
   └─ 否 → 走默认规则

2. 默认规则：在 xxx 同级寻找 xxx_cn
   /path/to/xxx  →  /path/to/xxx_cn
   ├─ 存在 → ✅ 正常
   └─ 不存在 → ❌ 显示错误（不创建）
```

**配对约定（推荐，零配置）**：英文根目录命名为 `source/`（或任意名），中文根约定为同级 `translated/`。也可显式配对（见配置示例）。

### 2.3 服务配置

```yaml
# paper-agent.yaml（服务启动目录或服务标准配置位置）
server:
  host: 127.0.0.1
  port: 8080

ollama:
  base_url: http://localhost:11434
  model: qwen2.5:7b          # 默认模型

# 工作区 = 英文根目录列表（每行一个一级目录）
workspaces:
  - /Users/you/research/transformer_papers/source
  - /Users/you/research/nlp/source
  - /Users/you/notes/english_books
  # 显式配对写法（可选）：
  # - source: /a/b/source
  #   translated: /a/b/translated
```

> **不使用数据库**存储工作区信息。如需持久化（多工作区元数据），用 `./data/state.json` 文件即可；初期甚至可省。

### 2.4 懒校验（不在启动时检查）

- 服务启动：只加载工作区**列表**（路径），**不检查目录是否存在**。
- **用户点击某个工作区时**，后端才校验：
  1. 英文根是否存在 → 不存在返回错误。
  2. 中文根定位（配置优先 → `xxx_cn` 默认）。
  3. 中文根是否存在 → 不存在返回 `missing_translated_root`。
- 每次点击**重新检查**（代价极低），用户在文件管理器新建 `xxx_cn` 后**下次点击立即生效，无需重启**。

**校验 API 响应**：

```json
// ✅ 200 正常
{
  "status": "ready",
  "source_root": "/path/to/xxx",
  "translated_root": "/path/to/xxx_cn",
  "tree": [ /* 文件树 */ ]
}

// ❌ 4xx 缺失中文根
{
  "status": "missing_translated_root",
  "source_root": "/path/to/xxx",
  "expected_translated_root": "/path/to/xxx_cn",
  "configured_translated_root": null,
  "message": "未找到中文根目录。请在文件系统中手动创建后重试。程序不会自动创建。"
}
```

---

## 3. 目录结构与命名

### 3.1 完整目录结构

```
/ws/transformer/                        ← 工作区（= 英文根所在位置，示例）
├── source/                            ← 英文根（只读，L1）
│   ├── attention_is_all_you_need.pdf
│   ├── sub_dir/
│   │   └── appendix.pdf
│   └── another_paper.pdf
│
└── translated/                        ← 中文根（用户必须事先创建，L2）
    │
    ├── _workspace/                    ← 工作区级产物（非隐藏）
    │   ├── glossary_qwen2_5_7b.json   ← 术语表（绑定模型，可共享/可分）
    │   ├── glossary_deepseek.json
    │   └── agent_memory/              ← 未来 Agent 长期记忆（P2/P3）
    │
    ├── attention_is_all_you_need/     ← 与 PDF 同名（不加后缀，L4/L5）
    │   ├── paper_qwen2_5_7b.md        ← 译文正文（模型后缀）
    │   ├── blocks_qwen2_5_7b.json     ← 对照结构化数据 / 跨页对齐（模型后缀）
    │   ├── paper_deepseek.md          ← 另一模型版本（同文多模型）
    │   ├── blocks_deepseek.json
    │   ├── _cache/                    ← 该文章中间产物（非隐藏，L6）
    │   │   ├── parse_mineru/          ← 解析产物（工具后缀）
    │   │   │   ├── layout.pdf
    │   │   │   ├── middle.json
    │   │   │   └── images/
    │   │   └── parse_marker/          ← 换解析器，并行存放
    │   └── sub_dir/                   ← 镜像子目录
    │       └── appendix/
    │           ├── paper_qwen2_5_7b.md
    │           ├── blocks_qwen2_5_7b.json
    │           └── _cache/
    │
    └── another_paper/
        └── ...
```

### 3.2 镜像规则（L4）

- `source/foo.pdf` ↔ `translated/foo/`（PDF 主名 → 同名目录）
- 子目录**完全镜像**：`source/sub/a.pdf` ↔ `translated/sub/a/`
- 目录名 = PDF 主名（不加后缀），**承载该论文的所有产物**（译文 + blocks + _cache）

### 3.3 命名规则（L5，带模型/工具后缀）

| 类型 | 模板 | 示例 |
|------|------|------|
| 译文正文 | `paper_{模型后缀}.md` | `paper_qwen2_5_7b.md` |
| 对照数据 | `blocks_{模型后缀}.json` | `blocks_qwen2_5_7b.json` |
| 术语表 | `glossary_{模型后缀}.json` | `glossary_qwen2_5_7b.json` |
| 解析缓存 | `_cache/parse_{工具后缀}/` | `_cache/parse_mineru/` |

**模型后缀规则**：取 Ollama 模型名，将 `: /` 等特殊字符转为 `_`，如 `qwen2.5:7b` → `qwen2_5_7b`。

---

## 4. 翻译内容规则

### 4.1 翻译粒度

- **按 PDF 原始页（page）为一级锚点**，以 **MinerU 检测到的视觉块（block）** 为二级单元。
- 逐 block 翻译，每个 block 记录所属 `page_idx`。
- **一页对一页**：译文 MD 用 `<!-- page: N -->` 分段，**不强制等长**，消除"一页英文对多页中文"的复杂度。

### 4.2 译文 Markdown 格式

```markdown
<!-- page: 1 -->
## Abstract
我们提出了一种基于注意力的新型神经网络架构...

<!-- page: 2 -->
## 1. Introduction
注意力机制已成为...

<!-- page: 3 -->
...
```

- 每个逻辑页段以 `<!-- page: N -->` 起始。
- 右侧渲染为连续长文档，每段为 `<section data-page="N">`（DOM 可定位）。
- 左侧 PDF.js 同样每页一个容器，**页边界两侧可对齐**。

### 4.3 不翻译的内容（do_not_translate）

| MinerU block 类型 | 翻译 | 说明 |
|-------------------|------|------|
| `text`（正文） | ✅ 翻译 | — |
| `title`（文章标题） | ❌ 不翻 | L |
| `heading`（章节标题） | ❌ 不翻 | Abstract / 3.1 Attention / References 均保留英文 |
| `interline_equation` / `display_equation` | ❌ 不翻 | LaTeX 原样保留 |
| `table` | ❌ 不翻 | 结构原样保留 |
| `image` | ❌ 不翻 | 图片不翻 |
| `figure_caption` / `table_caption`（图注/表注） | ❌ 不翻 | 保留原文 |
| `reference`（参考文献） | ❌ 不翻 | 保留原文 |

> 不翻译的 block：`zh = null`，`do_not_translate = true`，原样进入对照数据。

### 4.4 公式 / 表格 / 图片保护

- 翻译 prompt 强调：**严格保留 Markdown 标记、代码、LaTeX 公式（`$`、`$$`、`\begin`）、表格结构不变，仅翻译自然语言部分。**
- 这是技术 PDF 翻译最常见的翻车点，7B 模型尤其需要 prompt 强化 + 后校验。

---

## 5. 对照阅读 & 分页对齐

### 5.1 布局

```
┌──────────────────────────────────────────────────────────┐
│  (浏览器顶部不留应用 UI，最大化纵向空间)                    │
├────────────────────┬─────────────────────────────────────┤
│                    │  ┌────────────────────────────────┐ │
│  工作区 (一级)      │  │ 📄attention.pdf  翻译版本[▾][+新增]│ │  ← 悬浮右上角
│                    │  └────────────────────────────────┘ │
│  ▾ Transformer/    │                                    │
│    📄 attention.pdf │   EN (左)        │  ZH (右)        │
│    📁 sub_dir/      │  PDF(file://)   │  译文/流式/空态   │
│  ▾ NLP/             │                │                  │
│                    │                │                  │
└────────────────────┴────────────────┼──────────────────┘
```

- **左侧一级目录 = 工作区**（英文根），纵向空间不浪费。
- 右侧内容区**顶到浏览器顶部**（无顶部栏）。
- **悬浮控件**（版本选择器 + 新增）用 `position: absolute/fixed` 置于内容区右上角，**不占流布局高度**。

### 5.2 三种内容态（右栏）

| 状态 | 右栏表现 |
|------|----------|
| 未翻译 | 居中"还没有翻译内容" + 「马上翻译」可点击文字 |
| 翻译中 | SSE 实时流式渲染 |
| 已翻译 | 译文（file:// 或渲染 blocks），可对照阅读 |

- **左侧 PDF 永远 `file://` 直连**（原文不动）。
- **右侧翻译中**走接口（SSE 实时 block）；**翻译完成后**译文为本地 `.md`，可 `file://` 打开。
- **PDF `file://` 兜底**：先直连；若浏览器拦截（CORS / file origin），再加后端代理 `/api/files`（实测定，P0 不实现）。

### 5.3 滚动 & 锚点（核心）

#### 两类对齐（来源不同，存储分离）

| 类型 | 来源 | 存储 | 管理方 |
|------|------|------|--------|
| **跨页对齐**（`<!-- page: N -->` 边界） | MD 文档本身 | `blocks_{model}.json`（内容） | **后端提供，前端只读，不存前端** |
| **单页内微调锚点** | 用户手动微调 | `localStorage` | **前端** |

> 跨页对齐是内容固有的确定性事实，不属于锚点系统；单页内微调是用户交互状态。

#### 跟随规则（左右对称）

| 操作 | 对侧行为 |
|------|----------|
| **滚右侧(ZH) · 跨页** | 左侧**硬跳**到该页锚点 |
| **滚右侧(ZH) · 页内** | 左侧按**锚点分段插值**跟随 |
| **滚左侧(EN) · 跨页** | 右侧**硬跳**到该页锚点 |
| **滚左侧(EN) · 页内** | 右侧**不动**（仅校正锚点，见下） |

- **跨页 = 硬跳；页内 = 插值跟随。两侧完全对称。**
- 用 `isSyncing` 锁打破循环触发（程序自动滚动期间不反向跟随）。

#### 单页内锚点生成（前端 localStorage，唯一入口）

> 左侧在**某一页内微调**结束后，落定一个新锚点。结束信号 = **(a) 停下 ≥ 300ms** 或 **(b) 用户转去滚右侧**，任一命中即落定。

```pseudo
let leftIdleTimer = null

onScroll(left):
  if isSyncing: return
  clearTimeout(leftIdleTimer)
  leftIdleTimer = setTimeout(() => {
      saveAnchorToLocal(currentEN, currentZH)   // (a) 停 300ms
  }, 300)

onScroll(right):
  if isSyncing: return
  if leftIdleTimer:                              // (b) 用户转去滚右侧
      clearTimeout(leftIdleTimer)
      saveAnchorToLocal(currentEN, currentZH)    // 立即落定
  followLeft()                                   // 右侧滚动 → 左侧跟随

saveAnchorToLocal(en, zh):
  key = `anchors:{workspaceId}:{paperId}:{model}`
  anchors = read(key)
  anchors.push({ en_page, en_offset, zh_page, zh_offset })
  dedup(anchors)                                 // 同页内按 offset 去重，防膨胀
  localStorage.setItem(key, JSON.stringify(anchors))
```

- **锚点 key 隔离**：`anchors:{ws}:{paper}:{model}` —— 不同版本（模型）的微调锚点互相独立。
- **防膨胀**：同页内相近 offset 去重（保留最新）。
- **持久化**：存 `localStorage`（B 方案，刷新/重开仍在；换浏览器/设备无——符合"微调是用户对齐记忆"的定位）。

#### 插值使用

- 右侧页内滚动 → 左侧位置 = 在 **（固定跨页锚点 ∪ 单页内微调锚点）** 构成的分段上做**线性插值**。
- 跨页锚点（页边界，来自 blocks.json）+ 软锚点（页内，来自 localStorage）坐标体系统一，插值时一视同仁。

---

## 6. 翻译版本管理

### 6.1 版本 = 模型

- 一篇论文在不同模型下产生多个版本，每个版本 = `paper_{suffix}.md` + `blocks_{suffix}.json`。
- 版本 id = 模型后缀（如 `qwen2_5_7b`）。

### 6.2 UI：悬浮右上角

- 版本选择器 + `+ 新增翻译` **悬浮在内容区右上角**（`absolute/fixed`，`z-index` 高于译文），**不占顶部 / 流布局**。
- 滚动译文时**保持固定可见**（fixed / sticky）。
- 空态时也保留该控件（尤其 `+ 新增`）。

### 6.3 默认版本选择规则

```
给定：前端偏好 lastSelected + 后端版本列表 versions

① 前端是否存过偏好（localStorage）？
   是 → 该版本仍存在？  是 → ★ 用它
                       否 → 走 ②
   否 → 走 ②

② 取 created_at 最新的版本
   存在 → ★ 用它
   不存在 → 空态

★ 若选中版本 status = "translating" → 进入"边翻译边显示"（SSE 流）
```

**前端偏好存储**：

```
key:   paper_version:{workspaceId}:{paperId}
value: "qwen2_5_7b"
更新时机：用户每次从下拉选择 → 立即写入
读取时机：打开论文 → 读出 → 作为 ?version= 传 API
```

### 6.4 API 契约（fallback 规则）

```
GET /api/papers/:id/versions
  → 该论文所有版本列表（含 status / progress / created_at）

GET /api/papers/:id/content?version=
  version 指定且存在      → 用该版本
  version 指定但不存在    → fallback 最新
  未指定                  → 最新（created_at 最大，含生成中）
  返回额外字段：resolved_version, default_reason(preference|latest)

  若选中版本 status=translating → 升级为 SSE 流（边翻边显示）
```

### 6.5 状态与流程

| 状态 | 右栏 |
|------|------|
| 无任何翻译 | 空态："还没有翻译内容" + 「马上翻译」（文字链，蓝色） |
| 有翻译 + 版本 done | 显示译文 |
| 有翻译 + 版本 translating | SSE 流式 + 顶部进度条 |

**「马上翻译」=「+ 新增翻译」走同一流程（Step 1-4）**，仅空态时未预选模型。

#### 新增 / 重新翻译流程

```
Step 1. 弹窗：选择本地模型
        ┌─────────────────────────────┐
        │ 选择模型                    │
        │ ◉ qwen2.5:7b   (本地,已安装)│
        │ ○ qwen2.5-coder:7b         │
        │ ○ deepseek     (需配置 API) │
        │ [取消]          [开始翻译]   │
        └─────────────────────────────┘

Step 2. 校验：该模型版本是否已存在？
        · 查 versions 中是否有 id = 该模型后缀的版本
        · 不存在 → Step 4
        · 已存在 → Step 3

Step 3. 二次确认（覆盖已存在版本）
        ┌─────────────────────────────┐
        │ ⚠️ 该模型已有翻译结果        │
        │ 确定重新翻译吗？将覆盖已有。 │
        │ [取消]    [确认重新翻译]     │
        └─────────────────────────────┘

Step 4. 开始翻译
        POST /api/papers/:id/translate (model=, parser=)
        → 返回 SSE 流 → 右栏"边翻边显示"
        → 完成后新增版本，下拉自动选中
```

**覆盖策略 = A（同名覆盖 + 自动备份）**：

```
用户确认重翻 version = qwen2_5_7b：
  ① 备份：translated/foo/_cache/backup_qwen2_5_7b_<timestamp>/
           把当前 paper_*.md + blocks_*.json 移入
  ② 复用同名：blocks_qwen2_5_7b.json / paper_qwen2_5_7b.md
  ③ 从头翻译，SSE 流式覆盖写入
  ④ 完成 → 更新版本列表，下拉选中该版本
```

> 备份默认保留最近 **N=1** 份（覆盖即备份一次），避免无限膨胀。

### 6.6 SSE 事件

```
block_translated  { page, block_id, zh }
page_done        { page }
progress         { done, total, percent }
glossary_hit     { en, zh }
completed        { version, output }
```

---

## 7. 后端设计（Go）

### 7.1 职责

> **后端 = 纯内容服务**：提供 PDF / MD / blocks / 术语表 / 版本列表；执行解析与翻译。**不管理前端锚点。**

### 7.2 目录结构

```
paper-agent/
├── cmd/server/main.go            ← 入口（Gin / net/http）
├── internal/
│   ├── config/                   ← 读取 paper-agent.yaml
│   ├── workspace/                ← 工作区扫描、懒校验（读 state.json）
│   ├── parser/                   ← 调用 MinerU（exec.Command）
│   ├── agent/                    ← Agent 接口 + SequentialAgent
│   ├── ollama/                   ← 调本地 Ollama HTTP API
│   └── model/                    ← 数据结构（= 前端 TypeScript 类型）
├── parser_service/               ← Python（MinerU 调用 + middle.json 转换）
│   └── main.py
├── web/                          ← Next.js + TS + Tailwind（前端）
└── configs/paper-agent.example.yaml
```

### 7.3 API 清单

```
GET  /api/workspaces                → 工作区列表（懒校验，不启动检查）
GET  /api/workspaces/:id/tree      → 文件树（+ 校验中文根，缺失报错）

GET  /api/papers/:id/versions      → 版本列表（含 status/progress）
GET  /api/papers/:id/content?version=  → 译文（含 resolved_version）
GET  /api/papers/:id/md?version=   → paper_{ver}.md
GET  /api/files?path=              ← （兜底）代理本地文件

POST /api/papers/:id/parse?parser= → 调 MinerU → _cache/parse_xxx/
POST /api/papers/:id/translate?model=&parser=  → SSE 逐 block 翻译

GET  /api/workspaces/:id/glossary?model=
PUT  /api/workspaces/:id/glossary

GET  /api/models                   ← 本地可用模型列表（供下拉选择）
```

### 7.4 翻译编排（SequentialAgent，P0）

```
func StreamTranslate(paper):
    glossary = loadGlossary(workspace, model)
    for page in paper.pages:
        for block in page.blocks:
            if block.DoNotTranslate:
                yield block (zh=null)               // 原样
                continue
            prompt = buildPrompt(block.en, glossary.relevantTerms())
            resp = ollama.Chat(model, prompt)
            block.zh = resp
            newTerms = extractTerms(en, zh)         // 抽新术语
            glossary.merge(newTerms)
            yield block                              // SSE: block_translated
            saveBlocks(paper)                       // 每页落盘 → 断点续传
        yield page_done
    saveGlossary()
    generate paper_{model}.md                       // 写 <!-- page: N -->
    yield completed
```

### 7.5 Agent 扩展接口（预埋，逐步演进）

```go
// internal/agent/types.go —— P0 定义，贯穿始终
type Agent interface {
    Parse(ctx, pdfPath string) (*Paper, error)
    Translate(ctx, paper *Paper) <-chan Event   // SSE 事件流
    Review(ctx, block *Block, glossary) error   // P1 加入
}

// P0: 顺序实现
type SequentialAgent struct{ ... }

// P2: 拆 Python 微服务（LangGraph + 工具调用），Go 通过 HTTP 调用
type LangGraphAgent struct{ endpoint string }
```

| 阶段 | 能力 | 后端变化 | 前端变化 |
|------|------|----------|----------|
| P0 | 顺序翻译 + 术语注入 | `SequentialAgent` | 对照阅读 + 术语/版本面板 |
| P1 | + Reviewer（翻完审，不一致重试） | 状态机化 | 进度显示"审校中" |
| P2 | Python 微服务：LangGraph + 工具调用 | Go 调 LangGraph HTTP，接口不变 | 零改动 |
| P3 | 跨文档 RAG + 长期记忆 | `agent_memory/` + 向量检索 | 零改动 |

> **前后端契约（blocks JSON / SSE 事件）从 P0 到 P3 不变**，前端无需改，只换后端实现。
> LangGraph 为 Python 生态，Go 不直接运行；P2 拆为独立 Python 服务，Go 经 HTTP/gRPC 调用（接口隔离使切换无痛）。
> Ollama + Qwen 原生支持 Tool Calling，可用 `ollama.chat(tools=[...])` 让模型决定调工具。

---

## 8. 前端设计（Next.js + TS + Tailwind）

### 8.1 目录结构

```
web/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                    ← 工作区列表 / 入口
│   ├── workspace/[id]/page.tsx     ← 工作区内文件树
│   └── reader/[paperId]/page.tsx   ← ★ 对照阅读主界面
├── components/
│   ├── WorkspaceSwitcher.tsx       ← 左侧一级目录（工作区 = 英文根）
│   ├── FileTree.tsx
│   ├── Reader/
│   │   ├── DualPaneReader.tsx      ← 左右分栏 + 同步滚动
│   │   ├── PageColumn.tsx          ← 单页渲染（blocks）
│   │   ├── BlockRenderer.tsx       ← text/equation/table/image 分支
│   │   └── VersionSelector.tsx     ← ★ 悬浮右上角（下拉 + 新增）
│   ├── TranslateDialog.tsx         ← 选模型 / 二次确认
│   ├── EmptyState.tsx              ← "还没有翻译内容" + 马上翻译
│   └── GlossaryPanel.tsx
├── lib/
│   ├── api.ts                      ← fetch + EventSource
│   ├── syncScroll.ts               ← 跨页硬跳 / 页内插值 / isSyncing
│   ├── anchors.ts                  ← localStorage 读写 + dedup
│   └── types.ts                    ← 与 Go internal/model 对应
└── tailwind.config.ts
```

### 8.2 对照阅读核心：`syncScroll.ts`

```ts
// 核心：以 page 为锚点，非像素比例
export function usePageAnchoredSyncScroll(
  leftRef: Ref<HTMLDivElement>,
  rightRef: Ref<HTMLDivElement>,
  pages: Page[],
  source: 'left' | 'right'
) {
  // 1. IntersectionObserver 监听每页容器 → 当前主导页 currentPage
  // 2. 滚动侧(source)变化时：
  //    - currentPage 变了（跨页）→ 对侧硬跳到 anchor[currentPage]
  //    - currentPage 未变（页内）→ 在对侧按 (跨页锚点 ∪ 微调锚点) 分段插值
  // 3. isSyncing 锁防循环
}
```

### 8.3 渐进渲染：SSE 消费

```ts
// lib/api.ts
export function streamTranslate(
  paperId: string, model: string,
  onBlock: (b: Block) => void,
  onGlossary: (g: GlossaryEntry) => void,
  onDone: () => void
) {
  const es = new EventSource(`/api/papers/${paperId}/translate?model=${model}`);
  es.addEventListener('block_translated', e => onBlock(JSON.parse(e.data)));
  es.addEventListener('glossary_hit',   e => onGlossary(JSON.parse(e.data)));
  es.addEventListener('completed',       () => { onDone(); es.close(); });
  return es;
}
```

### 8.4 前后端共享类型（`lib/types.ts` ↔ Go `internal/model`）

```ts
export type BlockType =
  | 'text' | 'title' | 'heading'
  | 'interline_equation' | 'display_equation'
  | 'table' | 'image' | 'reference'
  | 'figure_caption' | 'table_caption';

export interface Block {
  id: string;
  type: BlockType;
  bbox?: [number, number, number, number];
  reading_order: number;
  en: string;
  zh: string | null;
  status: 'pending' | 'translated' | 'preserved' | 'error';
  do_not_translate: boolean;
}

export interface Page {
  page_idx: number;
  blocks: Block[];
}

export interface Anchor {
  en_page: number;
  en_offset: number;
  zh_page: number;
  zh_offset: number;
}

export interface GlossaryEntry {
  en: string;
  zh: string;
  count: number;
  confirmed: boolean;
  source: 'extracted' | 'user';
}

export interface Paper {
  id: string;
  model: string;
  source_pdf: string;
  workspace_id: string;
  pages: Page[];
  glossary: GlossaryEntry[];
  // 跨页对齐（内容，来自 MD/blocks，后端提供，前端只读）
  page_boundaries: Array<{ page: number; en_offset: number; zh_offset: number }>;
}

export interface Version {
  id: string;            // 模型后缀
  model: string;         // 完整模型名
  created_at: string;
  status: 'pending' | 'translating' | 'done' | 'error';
  progress?: number;     // 0~1，生成中
}
```

---

## 9. blocks\_\{model\}.json 数据契约（单一事实源）

```json
{
  "schema_version": 1,
  "paper_id": "attention_is_all_you_need",
  "model": "qwen2_5_7b",
  "source_pdf": "/ws/transformer/source/attention_is_all_you_need.pdf",
  "translated_md": "/ws/transformer/translated/attention_is_all_you_need/paper_qwen2_5_7b.md",
  "pages": [
    {
      "page_idx": 5,
      "blocks": [
        {
          "id": "p5_b0",
          "type": "text",
          "en": "...",
          "zh": "...",
          "do_not_translate": false,
          "status": "translated"
        },
        {
          "id": "p5_b1",
          "type": "interline_equation",
          "latex": "...",
          "do_not_translate": true
        }
      ]
    }
  ],
  "page_boundaries": [
    { "page": 1, "en_offset": 0, "zh_offset": 0 },
    { "page": 2, "en_offset": 3400, "zh_offset": 4100 }
  ],
  "glossary": [
    { "en": "self-attention", "zh": "自注意力", "confirmed": true }
  ]
}
```

> 前端对照阅读**只读此文件 + 左侧 PDF `file://`**。跨页对齐 `page_boundaries` 与译文 blocks 合二为一。

---

## 10. 术语一致性

### 10.1 双层术语库

```
translated/_workspace/
├── glossary_qwen2_5_7b.json      ← 本工作区术语（作用域 = 工作区）
└── glossary_deepseek.json
```

- **工作区 = 术语作用域**：不同工作区（Transformer / NLP）术语库完全隔离，互不污染。
- 术语 key 建议绑定模型后缀，避免多模型互相覆盖；也可抽出共享 `glossary_global.json`（按需）。

### 10.2 术语注入流程

```
1. 解析完 → 抽取候选术语（标题 + 高频名词短语）
2. 查 glossary → 已 confirmed 术语直接锁定
3. 翻译每个 block 时注入 prompt：
   "你必须使用以下术语：self-attention→自注意力, feed-forward→前馈..."
4. 翻译中遇到新术语 → 追加到 glossary（count++）
5. 用户在界面可"锁定 / 修改"术语 → confirmed=true，永久生效
```

### 10.3 跨文档一致性

- 同一工作区内，所有论文共享 `_workspace/glossary_*.json`。
- 翻译任何一篇前先加载它，翻完回写。
- P2/P3 可升级为向量库（ChromaDB + nomic-embed-text）；初期 JSON 零依赖。

---

## 11. PDF 解析

### 11.1 解析器选型

| 场景 | 推荐 | block 类型支持 |
|------|------|----------------|
| 日常文档 / 报告 | **Marker** | text / heading / equation / table / image |
| **学术论文（双栏 / 公式多）** | **MinerU**（主力） | 最全，含 `figure_caption` / `reference` 等 |

### 11.2 产物

- MinerU `middle.json` → 转换为我们的 `blocks_{model}.json`（page + block + 类型过滤 + glossary 抽取）。
- 原始产物放在 `translated/foo/_cache/parse_mineru/`。

### 11.3 Go 调用方式

- **P0**：Go `exec.Command` 串行调用 `magic-pdf`（16GB 顺序执行，不并行）。
- **P2**：如需并发 / 更解耦 → 拆 Python 解析微服务（FastAPI），Go 经 HTTP 调用。

---

## 12. P0 落地清单（实现阶段）

1. 工作区管理（多工作区、`source/translated` 镜像、懒校验、缺失报错）【Go】
2. PDF 解析（MinerU → blocks.json，类型过滤）【Go + Python】
3. 顺序翻译（Ollama qwen2.5:7b，SSE 逐 block）【Go】
4. 对照阅读（Next.js 左右分栏 + page 锚点同步滚动 + 悬浮版本选择器）【Next.js】
5. 术语表（工作区级 glossary.json，翻译前注入，实时更新）【Go + UI】
6. 版本管理（下拉 + 新增 + 空态 + 二次确认 + 覆盖备份）【Next.js + Go】
7. 锚点微调（localStorage，停 300ms / 转滚右侧 落定）【Next.js】
8. 中间记忆落盘（blocks.json 就近存 translated 对应目录，断点续传）

---

## 13. 附录：决策速查表

| # | 决策 |
|----|------|
| 1 | 工作区 = 英文根目录，配置列路径，左侧一级目录 |
| 2 | 中文根：配置优先 → `xxx_cn` 默认；缺失**只报错，绝不创建**（L2） |
| 3 | L1 英文根只读；L3 只写中文根下子目录 |
| 4 | 中文根**懒校验**（点击工作区时） |
| 5 | 目录镜像同名（L4）；产物带 `_{模型/工具}` 后缀（L5）；`_cache` 非隐藏（L6） |
| 6 | 译文 `<!-- page: N -->` 分段，**一页对一页** |
| 7 | title / heading / caption / equation / table / image / reference **不翻**；正文翻 |
| 8 | **跨页对齐 = 内容（blocks.json / MD），后端提供，不存前端** |
| 9 | **单页内微调锚点 = localStorage**，落定 = 停 300ms 或转滚右侧 |
| 10 | 跟随：跨页硬跳，页内插值，`isSyncing` 防循环 |
| 11 | 后端 Go（内容服务）；前端 Next.js + TS + Tailwind；PDF 先 `file://`（实测定代理） |
| 12 | 版本选择器**悬浮内容区右上角**，不占顶部；偏好 → 最新 → 空态 |
| 13 | 覆盖策略 = **A（同名覆盖 + 自动备份 N=1）**；重翻前二次确认 |
| 14 | Agent 接口预埋（P0 Sequential → P2 LangGraph），SSE 契约不变 |
| 15 | 术语作用域 = 工作区；初期 JSON，P2 可升向量库 |

---

**冻结声明**：本文件为讨论阶段最终成果，结构、铁律、数据契约、算法、API 均已确认。后续进入实现阶段，如需变更须显式更新本文件版本号。
