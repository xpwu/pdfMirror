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
}
