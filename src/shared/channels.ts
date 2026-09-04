// IPC 通道常量。集中定义，避免主进程与渲染进程各写字面量。

export const CH = {
	// 工作区列表（含中文根懒校验结果）
	WorkspaceList: "workspace:list",

	// 某个工作区的英文根目录树
	WorkspaceTree: "workspace:tree",

	// 读取本地文件的字节内容
	FileRead: "file:read"
} as const


// 文件协议名。
//
// 大文件（PDF / 译文 MD / blocks JSON）不走 IPC 以外的通道。
// 当前实现改用 IPC 直传字节：dev 模式下渲染进程 origin 是
// http://localhost:5173，自定义协议 pm:// 属跨源，会引入 CORS 问题。
// 且调用方本就整文件读取，Range 分片没有收益，故没有保留协议的必要。
export const FILE_SCHEME = "pm"

// 协议 host，无实际含义，仅用于构造合法的 URL
export const FILE_HOST = "local"


// FileURL 把本地绝对路径构造成可被 fetch 的 URL。
//
// 必须逐段编码再拼回：若对整条路径做 encodeURIComponent，
// 分隔符 "/" 也会被编码成 %2F，host 与 path 之间没有分界，
// 浏览器会报 "Failed to parse URL"。
export function FileURL(absPath: string): string {
	const encoded = absPath
		.split("/")
		.map((seg) => encodeURIComponent(seg))
		.join("/")

	return `${FILE_SCHEME}://${FILE_HOST}${encoded}`
}
