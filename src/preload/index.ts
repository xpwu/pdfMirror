import { contextBridge, ipcRenderer } from "electron"
import { electronAPI } from "@electron-toolkit/preload"

import { CH } from "../shared/channels"
import {
	IPCResult,
	PaperVersion,
	TreeNode,
	WorkspaceState
} from "../shared/types"


function gc(): boolean {
	const g = (globalThis as { gc?: () => void }).gc
	if (typeof g !== "function") return false

	try {
		g()
		return true
	} catch {
		return false
	}
}


const api = {
	WorkspaceList: (): Promise<IPCResult<WorkspaceState[]>> =>
		ipcRenderer.invoke(CH.WorkspaceList),

	WorkspaceTree: (sourceRoot: string): Promise<IPCResult<TreeNode[]>> =>
		ipcRenderer.invoke(CH.WorkspaceTree, sourceRoot),

	ReadFile: (absPath: string): Promise<IPCResult<Uint8Array>> =>
		ipcRenderer.invoke(CH.FileRead, absPath),

	PaperVersions: (
		sourceRoot: string,
		rel: string
	): Promise<IPCResult<PaperVersion[]>> =>
		ipcRenderer.invoke(CH.PaperVersions, sourceRoot, rel),

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
