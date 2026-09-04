import { contextBridge, ipcRenderer } from "electron"
import { electronAPI } from "@electron-toolkit/preload"

import { CH, FileURL } from "../shared/channels"
import { IPCResult, WorkspaceState } from "../shared/types"


// 暴露给渲染进程的能力白名单。
//
// 按「能力」而非「数据」暴露：不开 fs.readFile 之类的通用口子，
// 否则渲染进程就获得了任意文件访问权。
const api = {
	// 工作区列表，含中文根懒校验结果
	WorkspaceList: (): Promise<IPCResult<WorkspaceState[]>> =>
		ipcRenderer.invoke(CH.WorkspaceList),

	// 把本地绝对路径转成可 fetch 的 URL（走 pm:// 协议，不经 IPC）
	FileURL: (absPath: string): string => FileURL(absPath)
}

export type API = typeof api


if (process.contextIsolated) {
	try {
		contextBridge.exposeInMainWorld("electron", electronAPI)
		contextBridge.exposeInMainWorld("api", api)
	} catch (error) {
		console.error(error)
	}
} else {
	// @ts-ignore (define in dts)
	window.electron = electronAPI
	// @ts-ignore (define in dts)
	window.api = api
}
