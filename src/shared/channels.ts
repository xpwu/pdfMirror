// IPC 通道常量。集中定义，避免主进程与渲染进程各写字面量。

export const CH = {
	// 工作区列表（含中文根懒校验结果）
	WorkspaceList: "workspace:list",

	// 某个工作区的英文根目录树
	WorkspaceTree: "workspace:tree"
} as const


// 文件协议名。
//
// 渲染进程通过 fetch(`pm://local/<编码后的绝对路径>`) 读取本地文件。
// 大文件（PDF / 译文 MD / blocks JSON）必须走这里，不走 IPC：
// IPC 有结构化克隆的序列化开销，大内容会明显卡顿。
export const FILE_SCHEME = "pm"

// 协议 host，无实际含义，仅用于构造合法的 URL
export const FILE_HOST = "local"


// FileURL 把本地绝对路径构造成可被 fetch 的 URL。
//
// 路径整体编码（含分隔符）后作为 pathname，
// 主进程侧 decodeURIComponent 一次即可还原。
export function FileURL(absPath: string): string {
	return `${FILE_SCHEME}://${FILE_HOST}${encodeURIComponent(absPath)}`
}
