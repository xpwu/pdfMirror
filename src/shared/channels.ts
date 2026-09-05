// IPC 通道常量。集中定义，避免主进程与渲染进程各写字面量。

export const CH = {
	WorkspaceList: "workspace:list",
	WorkspaceTree: "workspace:tree",
	FileRead: "file:read",
	PaperVersions: "paper:versions"
} as const
