# 本地论文翻译 Agent · 设计文档

> 版本：1.1（Electron 实现版）
> 状态：**v1.0 的 web 架构（Go 后端 + Next.js 前端）已废弃，改为纯 Electron；其余设计沿用**
> 目标：将「PDF 解析 → 本地模型翻译 → 分页对照阅读 → 多模型版本管理」集成到一个本地工具中，支持逐步扩展为 Agent。
>
> **v1.1 主要变更**
>
> | 位置 | v1.0 | v1.1 |
> |------|------|------|
> | 架构 | Go 后端 + Next.js 前端 | **Electron 主进程 + 渲染进程** |
> | §2.3 配置 | `paper-agent.yaml`（含服务端口、Ollama 地址） | **`workspaces.json`（只有工作区列表）** |
> | §3.1 图片 | `_cache/parse_{工具}/images/` | **与译文同级 `images_{工具}/`** |
> | §3.2 有译文判定 | 目录存在 | **目录内有 `paper_*.md`** |
> | §5.2 文件读取 | `file://` 直连 | **IPC 直传字节** |
> | §7 | 后端设计（Go + HTTP API） | **主进程设计（Electron + IPC）** |
> | §8 | 前端设计（Next.js 路由） | **渲染进程设计（React 单组件树）** |
>
> 新增：§4.5 切页兜底、§6.7 不联动模式、§9 AI 的边界。

---

## 0. 目标与非目标

### 0.1 目标

1. 本地管理多篇英文论文，按工作区组织。
2. 用本地模型（Ollama + Qwen 系列）将论文逐段翻译为中文。
3. 解析阶段保留**公式 / 表格 / 图片 / 图注 / 表注 / 参考文献**，这些内容**不翻译**。
4. 提供**左右对照阅读**界面：左=英文原文 PDF，右=中文译文。
5. 左右**按页对齐**，支持轻量手动微调，微调结果持久化。
6. 同一篇论文支持**多个模型版本**，可切换、可重新翻译。
7. 主进程 = 内容服务（Electron Main），渲染进程 = React + TypeScript + Tailwind，逐步扩展为 Agent。

### 0.2 非目标（明确不做）

- 不提供云端协作 / 多用户（纯本地个人工具）。
- 不做"自动判断翻译质量并重翻"的智能逻辑（P0；P2 再扩展）。
- 不自动创建任何用户数据目录（见铁律 L2）。

---

## 1. 核心原则 / 铁律

> 这些是不可违反的硬性约束，后续任何实现（含 Agent 扩展）都必须遵守。

| ID | 规则 | 说明 |
|----|------|------|
| **L1** | **英文根目录只读** | **程序**绝不向英文根写入任何文件 / 文件夹 |
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

**实现细节（求路径与查存在分两步）**

1. 配置的中文根非空（去空白后判断）→ 直接使用。
2. 否则取英文根，**先去掉结尾的斜杠**再补 `_cn`：

   - `/path/to/source`  → `/path/to/source_cn`
   - `/path/to/source/` → `/path/to/source_cn`

3. 只写中文根不写英文根 → **非法配置**，跳过并报错。

**「先求路径、后查存在」是必须的**：中文根不存在时要提示用户"请在磁盘上创建 xxx"，
需要给出**具体路径**，而它可能是配置值也可能是推导值 —— 必须显式返回，不能让前端自行计算（L2：程序绝不代劳）。

**配对约定（推荐，零配置）**：英文根目录命名为 `source/`（或任意名），中文根约定为同级 `translated/`。也可显式配对（见配置示例）。

### 2.3 应用配置

> **v1.1**：原 `paper-agent.yaml`（含服务端口、Ollama 地址）已随 Go 后端一并废弃。
> 工作区列表改为 **JSON 文件，由人直接编辑**。

```json
// workspaces.json
[
  { "SourceRoot": "/Users/you/research/transformer_papers/source" },

  { "SourceRoot": "/Users/you/research/nlp/source",
    "TranslatedRoot": "/Users/you/research/nlp/cn" }
]
```

- `SourceRoot`：**必填**，同时作为工作区唯一 id（本机路径唯一）。
- `TranslatedRoot`：**可选**，留空则按默认规则推导（§2.2）。

**存放位置**

| 环境 | 路径 |
|------|------|
| 开发（`npm run dev`） | 项目根 `.dev-data/workspaces.json` |
| 打包后运行 | 应用数据目录 `workspaces.json` |

> **不使用数据库**（沿用 v1.0 的决定）。
>
> **业务数据（原文 / 译文 / 图片）不进应用目录** —— 否则备份与迁移会很麻烦。
> 应用目录只放"应用配置"，用户数据始终留在用户指定的工作区里。

### 2.4 懒校验（不在启动时检查）

- 服务启动：只加载工作区**列表**（路径），**不检查目录是否存在**。
- **用户点击某个工作区时**，主进程才校验：
  1. 英文根是否存在 → 不存在返回错误。
  2. 中文根定位（配置优先 → `xxx_cn` 默认）。
  3. 中文根是否存在 → 不存在返回 `missing_translated_root`。
- 每次点击**重新检查**（代价极低），用户在文件管理器新建 `xxx_cn` 后**下次点击立即生效，无需重启**。

**校验返回（`workspace:list` IPC）**

```ts
class WorkspaceState {
    Config: WorkspaceConfig   // SourceRoot / TranslatedRoot
    Name: string              // 显示名，由英文根推导
    SourceExists: boolean
    TranslatedExists: boolean
    TranslatedRoot: string    // ★ 实际使用的中文根（配置值或推导值）
}
```

- 中文根缺失**不是错误**：返回 `TranslatedExists: false` 与推导出的 `TranslatedRoot`，
  前端据此在**译文区**显示"请在磁盘上创建 xxx"（L2：程序绝不代劳）。
- `TranslatedRoot` 单独返回，是因为前端提示需要具体路径（见 §2.2）。
- 传输约定见 §7.4。

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
    │   │
    │   ├── images_mineru/             ← ★ 图片：与译文同级（v1.1 变更）
    │   │   ├── fig1.jpg
    │   │   └── table_1.jpg
    │   │
    │   ├── _cache/                    ← 该文章中间产物（非隐藏，L6）
    │   │   ├── parse_mineru/          ← 解析产物（工具后缀）
    │   │   │   ├── layout.pdf
    │   │   │   └── middle.json
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

> **★ v1.1 变更：图片位置**
>
> 图片原定放在 `_cache/parse_{工具}/images/` 下，现改为**与译文同级**的 `images_{工具后缀}/`。
>
> 1. 图片 / 公式 / 图表**不参与翻译**（§4.3），任何模型产出的这部分都一样，
>    它是译文的**公共组成部分**，不是"某个模型的中间产物"。
> 2. `_cache/` 的语义是**可清理**（删掉能重建）。图片丢了译文就残缺，语义冲突。
> 3. 将来要比对不同 PDF 抓取工具的切分效果时，用后缀并列存放即可：
>    `images_mineru/`、`images_pdfplumber/`，互不干扰。
>
> 译文 MD 内的引用相对**译文所在目录**解析，如 `![](images_mineru/fig1.jpg)`。

### 3.2 镜像规则（L4）

- `source/foo.pdf` ↔ `translated/foo/`（PDF 主名 → 同名目录）
- 子目录**完全镜像**：`source/sub/a.pdf` ↔ `translated/sub/a/`
- 目录名 = PDF 主名（不加后缀），**承载该论文的所有产物**（译文 + blocks + 图片 + _cache）

**「有译文」的判定**：以**目录内存在至少一个 `paper_*.md`** 为准，**不看目录是否存在**。

翻译中途失败时目录已建但里面只有 `_cache/`，此时若判定"有译文"，
用户点进去会看到空态与"译"标记自相矛盾。

### 3.3 命名规则（L5，带模型/工具后缀）

| 类型 | 模板 | 示例 |
|------|------|------|
| 译文正文 | `paper_{模型后缀}.md` | `paper_qwen2_5_7b.md` |
| 对照数据 | `blocks_{模型后缀}.json` | `blocks_qwen2_5_7b.json` |
| 术语表 | `glossary_{模型后缀}.json` | `glossary_qwen2_5_7b.json` |
| 解析缓存 | `_cache/parse_{工具后缀}/` | `_cache/parse_mineru/` |
| 图片 | `images_{工具后缀}/` | `images_mineru/`（与译文同级，§3.1） |

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

### 4.5 切页的兜底规则

AI 翻译不可能覆盖所有情况。以下三条按「**先展示、再提示**」处理：

1. **缺页留空**：`<!-- page: 4 -->` 直接跳到 `<!-- page: 6 -->` 时，第 5 页渲染为**空 section**。
   页码必须严格对齐 —— 宁可右侧空一块，也不能让页码错位，错位会让锚点全乱。
   同时显示"本页译文缺失"，用户一眼能看出缺了哪几页。

2. **完全没有 page 标记**：整篇作为第 1 页，进入**不联动模式**并提示（§6.7）。

3. **第一个标记之前的内容**：归入第 1 页。PDF 第一页本就含标题与摘要，归到第 1 页才对得上。

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

> **v1.1**：图中 `PDF(file://)` 已改为 **IPC 读取**（§5.2）；
> "浏览器顶部"改为"窗口顶部"—— 不再有浏览器 chrome。

### 5.2 三种内容态（右栏）

| 状态 | 右栏表现 |
|------|----------|
| 未翻译 | 居中"还没有翻译内容" + 「马上翻译」可点击文字 |
| 翻译中 | 事件流实时渲染 |
| 已翻译 | 渲染译文 MD（或 blocks），可对照阅读 |

- **文件读取统一走 IPC**，不用 `file://`，也不用自定义协议。

  > **v1.1 实测结论**（三条路都试过，这是唯一走得通的）
  >
  > 1. `file://` —— 渲染进程受同源策略限制，取不到字节。
  > 2. 自定义协议 —— 注册为标准协议后仍有两个坑：
  >    dev 模式下渲染进程 origin 是本地 dev server，**跨源需 CORS 头**；
  >    pdf.js 对 url 有**协议白名单校验**，自定义协议不在名单内，直接拒绝。
  > 3. 调用方本就**整文件读取**（pdf.js 需要完整字节），Range 分片无收益。
  >
  > 因此：主进程读文件 → **过 PathGuard** → 经 IPC 直传字节。
  > 几 MB 的 PDF 传递开销可忽略。

- **右侧译文**为本地 `.md`，同样走 IPC，解码后按 `<!-- page: N -->` 切页（§4.5）。
- **翻译中**（待实现）由主进程推送事件，渲染进程逐块渲染。

### 5.3 滚动 & 锚点（核心）

#### 两类对齐（来源不同，存储分离）

| 类型 | 来源 | 存储 | 管理方 |
|------|------|------|--------|
| **跨页对齐**（`<!-- page: N -->` 边界） | MD 文档本身 | `blocks_{model}.json`（内容） | **主进程提供，渲染进程只读，不存渲染进程** |
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
给定：渲染进程偏好 lastSelected + 主进程版本列表 versions

① 前端是否存过偏好（localStorage）？
   是 → 该版本仍存在？  是 → ★ 用它
                       否 → 走 ②
   否 → 走 ②

② 取 created_at 最新的版本
   存在 → ★ 用它
   不存在 → 空态

★ 若选中版本 status = "translating" → 进入"边翻译边显示"（事件流）
```

**前端偏好存储**：

```
key:   paper_version:{workspaceId}:{paperId}
value: "qwen2_5_7b"
更新时机：用户每次从下拉选择 → 立即写入
读取时机：打开论文 → 读出 → 作为版本参数传入
```

### 6.4 IPC 契约（fallback 规则）

> **v1.1**：原 HTTP 接口已改为 IPC 通道，语义不变。

| 通道 | 职责 |
|------|------|
| `paper:versions` | 该论文所有版本列表（含状态与进度） |
| `paper:content` | 取某版本的译文内容（含解析后的实际版本） |

**fallback 规则**（沿用 v1.0）

- 指定版本且存在 → 用它。
- 指定版本但不存在 → fallback 到最新。
- 未指定 → 取最新（含生成中的版本）。
- 返回额外字段 `resolved_version` 与 `default_reason`（`preference` / `latest`），
  让前端能解释"为什么选中这个版本"（§9：不静默替用户做决定）。

若选中版本处于翻译中 → 切换为事件流，边翻边显示。

### 6.5 状态与流程

| 状态 | 右栏 |
|------|------|
| 无任何翻译 | 空态："还没有翻译内容" + 「马上翻译」（文字链，蓝色） |
| 有翻译 + 版本 done | 显示译文 |
| 有翻译 + 版本 translating | 事件流 + 顶部进度条 |

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
        触发翻译（主进程，model=, parser=）
        → 事件流 → 右栏"边翻边显示"
        → 完成后新增版本，下拉自动选中
```

**覆盖策略 = A（同名覆盖 + 自动备份）**：

```
用户确认重翻 version = qwen2_5_7b：
  ① 备份：translated/foo/_cache/backup_qwen2_5_7b_<timestamp>/
           把当前 paper_*.md + blocks_*.json 移入
  ② 复用同名：blocks_qwen2_5_7b.json / paper_qwen2_5_7b.md
  ③ 从头翻译，流式覆盖写入
  ④ 完成 → 更新版本列表，下拉选中该版本
```

> 备份默认保留最近 **N=1** 份（覆盖即备份一次），避免无限膨胀。

### 6.6 翻译事件流

> **v1.1**：不走 SSE，改由主进程向渲染进程推送事件。
> 事件结构保持与 v1.0 一致，**具体字段待实现翻译功能时确定**，此处只定类别。

```
block_translated  { page, block_id, zh }
page_done        { page }
progress         { done, total, percent }
glossary_hit     { en, zh }
completed        { version, output }
```

---

### 6.7 不联动模式

**触发条件**（满足任一）

- 译文没有任何 `<!-- page: N -->` 标记。
- 译文页数 **>** 原文页数。

**表现**

- 顶部提示条，说明**具体原因**（无标记 / 超页）。
- 译文**全量展示，不做切页**。
- 关闭左右滚动联动。

**为什么不是"丢弃多出的页"**

译文页数多于原文，说明译文本身可能有问题。
此时「译文与原文页数一一对应」这个联动前提**已不成立**，
强行联动必然产生错误的对应关系 —— 用户会看到错位却毫不知情，这比不联动更糟。

所以：明确告知 + 全量展示，把判断权交还给用户（§14）。

---

## 7. 主进程设计（Electron Main）

> **v1.1 架构变更**：原 **Go 后端 + HTTP API** 已废弃，改为 **Electron 主进程 + IPC**。
>
> 原因：本工具是纯本地个人工具（§0.2 明确不做多用户 / 云端协作），
> 引入 HTTP 服务与前后端分离只增加部署复杂度，不带来收益。

### 7.1 职责

> **主进程 = 纯内容服务**（沿用 v1.0 定位）：提供 PDF / MD / 图片 / 版本列表的读取；
> 执行解析与翻译。**不管理前端锚点**（§5.3）。

两条硬约束：

- **所有文件系统访问必须在主进程**，且**先过 PathGuard**（L1/L2/L3）。
- 渲染进程**无 Node 集成**，一切能力经 `preload` 白名单暴露，
  且**按能力而非按数据**暴露 —— 不开"读任意文件"之类的通用口子，
  否则渲染进程就获得了越权的文件访问能力。

### 7.2 四层结构

| 层 | 职责 |
|------|------|
| `main/service/` | 业务逻辑：路径守卫、工作区、文件树、译文版本 |
| `main/ipc/` | IPC handler，**保持很薄**，只做转调与错误包装 |
| `preload/` | 能力白名单（桥接） |
| `shared/` | 主进程与渲染进程**共享的类型与通道常量** |

> `shared/` 是 v1.1 新增的一层：两个进程在同一 TS 工程内，
> **契约变更会在编译期暴露**，不需要靠文档或注释去对齐 ——
> 这消掉了 v1.0 里"Go struct tag ↔ TS 类型手写对齐"的那类隐患。

### 7.3 IPC 通道

| 通道 | 对应 v1.0 API |
|------|----------------|
| `workspace:list` | `GET /api/workspaces` |
| `workspace:tree` | `GET /api/workspaces/:id/tree` |
| `file:read` | `GET /api/files?path=` |
| `paper:versions` | `GET /api/papers/:id/versions` |
| `paper:content` | `GET /api/papers/:id/content?version=` |
| （待实现）`paper:translate` | `POST /api/papers/:id/translate` |
| （待实现）`models:list` | `GET /api/models` |
| （待实现）`glossary:get` / `glossary:put` | `GET` / `PUT /api/workspaces/:id/glossary` |

### 7.4 传输约定

统一返回 `[返回值, 错误]` 元组，错误为 `string | null`。

> `Error` 实例跨进程结构化克隆后会退化成普通对象，`instanceof` 失效，
> 因此边界上**统一用 string 传递错误信息**，渲染进程侧再包成 `Error`。

### 7.5 安全边界（PathGuard）

> 所有跨进程文件访问的**唯一入口**。铁律 L1 / L2 / L3 全部落在这里。

- **读**：路径必须落在某个已配置工作区的英文根或中文根下。
- **写**：必须在中文根下；英文根一律拒绝（L1）。

三个关键实现点：

1. **符号链接**必须解析为真实路径后再比对 —— 符号链接是目录穿越的经典绕过手段。
2. **前缀比较要补上路径分隔符** —— 否则 `/data/root_other` 会被误判为 `/data/root` 的子路径。
3. **中文根缺失只标记、不创建**（L2），由前端提示具体路径。

### 7.6 翻译编排（待实现）

> v1.1 尚未实现翻译。编排顺序沿用 v1.0 §7.4，实现语言改为 TypeScript，执行位置为主进程。
> **事件字段与 prompt 结构待实现时确定**，此处只定顺序：

```
载入术语表
  → 逐页 → 逐 block
      → 不翻译的 block 原样进入（§4.3）
      → 其余调模型翻译，抽取并合并新术语
      → 每页落盘（支持断点续传）
  → 保存术语表
  → 生成 paper_{模型}.md，写入 <!-- page: N -->
```

**子进程回收（v1.1 新增约束）**：翻译会 spawn MinerU（Python）与 Ollama。
应用退出时须 kill 整个进程树，否则会成为孤儿进程，
继续占用内存（与本地 7B 模型抢资源）并写文件。

### 7.7 Agent 扩展（预埋，逐步演进）

> 接口先行、实现后置。阶段规划沿用 v1.0 §7.5，不变。

| 阶段 | 能力 | 主进程变化 | 渲染进程变化 |
|------|------|------------|--------------|
| P0 | 顺序翻译 + 术语注入 | `SequentialAgent` | 对照阅读 + 版本面板 |
| P1 | + Reviewer（翻完审，不一致重试） | 状态机化 | 进度显示"审校中" |
| P2 | 拆 Python 微服务（LangGraph + 工具调用） | 经 HTTP 调用，接口不变 | 零改动 |
| P3 | 跨文档 RAG + 长期记忆 | `agent_memory/` + 向量检索 | 零改动 |

> **契约（blocks JSON / 事件流）从 P0 到 P3 不变**，渲染进程无需改动，只换主进程实现。
> Ollama + Qwen 原生支持 Tool Calling，可用工具调用让模型决定调什么。

## 8. 渲染进程设计（React + TS + Tailwind）

### 8.1 分层

> **v1.1 架构变更**：原 **Next.js（App Router / 多路由页面）** 已废弃，
> 改为 **Electron 渲染进程 + React 单组件树**。
>
> 原因：本地单窗口应用，无路由 / 无 SSR / 无 SEO 需求。
> 多页路由反而割裂状态（工作区 → 论文 → 译文的选中态要跨页传递），
> 单组件树持有全部状态更简单。

沿用 v1.0 的 `api / components` 分层约定，**只换传输层**：
`api/` 由"调 HTTP 接口"改为"调 preload 暴露的 IPC"。

| 层 | 职责 |
|------|------|
| `api/` | 取数据 + 错误包装，不持有状态 |
| `db/` | 持有内存状态，不关心数据从哪来 |
| `components/` | 纯展示 |
| `lib/` | 与 React 无关的纯逻辑 |

> 分层的意义：数据来源可替换（IPC → 其他）时，组件层零改动。

### 8.2 两个实测约束（PDF 渲染）

这两条是 v1.1 实测踩出来的，属于**渲染 PDF 必须遵守**的约束：

1. **文档操作必须串行化**

   pdf.js 的 worker 是全局单例。并发执行"销毁旧文档"与"打开新文档"时，
   旧文档的销毁会取消 worker 中排队的新文档解析任务，
   导致打开文档的 promise **既不 resolve 也不 reject**，界面永久停在"加载中"。

   → 所有文档操作串到一条 promise 链上，任一时刻只有一个在跑。

2. **位图内存必须显式释放**

   canvas 位图**不在 JS 堆里**，由 Chromium 独立管理；
   且释放后内存会留在分配器池子里复用、**不还给操作系统**
   （所以系统监视器的 RSS 天然下不来，不能据此判断泄漏）。

   → 仅移除 DOM 不回收，必须先把 canvas 宽高置零；
   → 配合虚拟滚动（只渲染视口附近的页），内存与论文总页数无关。

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

---

## 14. AI 的边界（基本原则）

> **AI 翻译不可能搞定所有情况。当 AI 搞不定时：
> 把已有的产物按最可能的情况展示给用户，
> 但必须给用户一个可以自己操作的交互。**
>
> **是用户使用 AI，而不是 AI 控制用户。**
>
> 任何"AI 没搞定"的情况，都不能以**静默失败、静默丢弃**、
> 或以"为你好"为由**替用户做决定**的方式处理。

### 本文档中的具体体现

| 情况 | 展示方式 | 给用户的交互 |
|------|----------|--------------|
| 译文缺页 | 留空 section + "本页译文缺失" | 用户自行判断是否需要重翻 |
| 无页码标记 | 整篇展示 + 提示不联动 | 用户知道不能依赖翻页对齐 |
| 译文超页 | 全量展示 + 提示原因 | 用户知道译文可能有误 |
| 图片缺失 | 占位框 + "查看路径" | 给出完整路径，用户自己查文件 |
| 公式 | KaTeX 渲染 | 点击复制原文 |
| 中文根缺失 | 译文区显示待创建路径 | 用户自己在磁盘创建，**程序绝不代劳** |
| 解析 / 翻译失败 | 保留已有产物 + 说明失败位置 | 用户决定是否重跑 |

### 落地检查清单

新增任何"AI 产出"相关功能时，问自己三个问题：

1. AI 失败 / 部分成功时，界面**显示什么**？
2. 用户**如何知道**发生了什么？（不能静默）
3. 用户**能做什么**？（必须有可操作的出口）

三个问题有一个答不上来，这个功能就不算做完。
