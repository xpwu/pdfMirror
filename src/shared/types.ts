// 主进程与渲染进程共享的类型定义。
//
// 由于两个进程在同一个 TS 工程内，这里的类型可被双方直接 import，
// IPC 契约的变更会在编译期暴露，不需要靠文档或注释去对齐。

// IPC 通道的返回约定：沿用 [返回值, 错误] 的元组风格。
//
// 注意：Error 实例无法跨进程保持原型（结构化克隆后变成普通对象，
// instanceof 失效），因此 IPC 边界上统一用 string 传递错误信息。
export type IPCError = string | null
export type IPCResult<T> = [T, IPCError]


// 工作区配置，即数据库 workspaces.json 里的一条记录。
//
// SourceRoot 是英文根，同时作为工作区的唯一 id（本机路径唯一）。
// TranslatedRoot 可留空：按默认规则从 SourceRoot 推导（见 ResolveTranslatedRoot）。
export class WorkspaceConfig {
	SourceRoot: string = ""
	TranslatedRoot: string = ""
}


// 工作区状态 = 配置 + 懒校验结果。
//
// 校验在「点击工作区」时才做（懒校验），服务启动时不检查。
export class WorkspaceState {
	Config: WorkspaceConfig = new WorkspaceConfig()

	// 显示名，由 SourceRoot 推导，不单独存储
	Name: string = ""

	SourceExists: boolean = false

	// 中文根是否存在。false 时前端显示引导，由用户自己在磁盘上创建。
	// 程序绝不自动创建 —— 这是铁律 L2。
	TranslatedExists: boolean = false

	// 实际使用的中文根。
	//
	// 可能来自配置，也可能由默认规则推导，
	// 前端展示错误信息时需要给出这个具体路径。
	TranslatedRoot: string = ""
}


// 目录树节点。
//
// IsDir 为 true 时 Children 非空；为 false 时是 PDF 文件。
export class TreeNode {
	Name: string = ""
	Rel: string = ""
	IsDir: boolean = false

	// 是否已有译文：中文根下对应目录内存在至少一个 paper_*.md。
	//
	// 「目录存在」不等于「有译文」—— 目录里可能只有 _cache，
	// 或翻译中途失败只留下了中间产物。
	HasTranslated: boolean = false

	Children: TreeNode[] = []
}


// 一篇译文版本。
//
// 版本即模型：同一篇论文可有多篇译文，文件名 paper_{suffix}.md，
// suffix 由模型名按 §3.3 的规则转义而来（如 qwen2.5:7b -> qwen2_5_7b）。
//
// 转义不可逆（无法区分哪个 _ 原本是 . 哪个是 :），
// 因此展示名直接用 suffix，完整文件名在 MdAbsPath 中。
export class PaperVersion {
	Model: string = ""
	MdRelPath: string = ""   // 相对中文根
	FileName: string = ""    // paper_xxx.md
	ModifiedAt: number = 0   // 毫秒时间戳，用于默认选中
}
