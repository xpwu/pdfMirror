import { contextBridge, ipcRenderer } from "electron"
import { electronAPI } from "@electron-toolkit/preload"

import { CH } from "../shared/channels"
import { IPCResult, TreeNode, WorkspaceState } from "../shared/types"


// 触发 V8 垃圾回收。
//
// 需要主进程以 --js-flags=--expose-gc 启动才可用。
// 返回是否真的执行了 —— 调用方据此决定是否提示用户。
function gc(): boolean {
	const g = (globalThis as { gc?: () => void }).gc

	if (typeof g !== "function") {
		return false
	}

	try {
		g()
		return true
	} catch {
		return false
	}
}


// 暴露给渲染进程的能力白名单。
//
// 按「能力」而非「数据」暴露：不开 fs.readFile 之类的通用口子，
// 否则渲染进程就获得了任意文件访问权。
// ReadFile 看似通用，但主进程侧强制过 PathGuard，
// 超出工作区的路径一律拒绝。
const api = {
	// 工作区列表，含中文根懒校验结果
	WorkspaceList: (): Promise<IPCResult<WorkspaceState[]>> =>
		ipcRenderer.invoke(CH.WorkspaceList),

	// 英文根目录树
	WorkspaceTree: (sourceRoot: string): Promise<IPCResult<TreeNode[]>> =>
		ipcRenderer.invoke(CH.WorkspaceTree, sourceRoot),

	// 读取工作区内的文件字节（走 IPC，不经自定义协议）
	ReadFile: (absPath: string): Promise<IPCResult<Uint8Array>> =>
		ipcRenderer.invoke(CH.FileRead, absPath),

	// 触发 V8 GC（调试用）
	GC: (): boolean => gc()
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
