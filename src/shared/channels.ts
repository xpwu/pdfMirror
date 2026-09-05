// IPC 通道常量。集中定义，避免主进程与渲染进程各写字面量。

export const CH = {
	WorkspaceList: "workspace:list",
	WorkspaceTree: "workspace:tree",
	FileRead: "file:read",
	PaperVersions: "paper:versions"
} as const


// 文件协议名。
//
// 大文件（PDF / 译文 MD）走 IPC 直传字节：
// dev 模式下渲染进程 origin 是 http://localhost:5173，
// 自定义协议 pm:// 属跨源，会引入 CORS 问题。
// 且调用方本就整文件读取，Range 分片没有收益。
export const FILE_SCHEME = "pm"
export const FILE_HOST = "local"


// FileURL 把本地绝对路径构造成可被 fetch 的 URL。
//
// 必须逐段编码再拼回：对整条路径做 encodeURIComponent 会把
// 分隔符 "/" 也编码成 %2F，浏览器会报 "Failed to parse URL"。
export function FileURL(absPath: string): string {
	const encoded = absPath
		.split("/")
		.map((seg) => encodeURIComponent(seg))
		.join("/")

	return `${FILE_SCHEME}://${FILE_HOST}${encoded}`
}
