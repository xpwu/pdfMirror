import { app, BrowserWindow, protocol, net } from "electron"
import { electronApp, optimizer, is } from "@electron-toolkit/utils"
import path from "node:path"

import { FILE_SCHEME, FILE_HOST } from "../shared/channels"
import { PathGuard } from "./service/pathGuard"
import { LoadWorkspaces } from "./service/workspace"
import { Register as RegisterWorkspaceIPC } from "./ipc/workspace"


// pm:// 必须注册为 standard scheme，否则渲染进程的 fetch 无法使用它。
//
// 这一步必须在 app 的 ready 事件之前调用 —— 放在 whenReady 里会失效。
protocol.registerSchemesAsPrivileged([
	{
		scheme: FILE_SCHEME,
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
			bypassCSP: true
		}
	}
])


// registerFileProtocol 注册 pm:// 协议，供渲染进程读取本地文件。
//
// 所有请求都要先过 PathGuard，这是本地文件访问的唯一入口。
// 透传 method 与 headers 是为了支持 Range 请求 ——
// PDF.js 加载大 PDF 时必须靠分片加载，没有 Range 会退化为整体下载。
function registerFileProtocol(guard: PathGuard): void {
	protocol.handle(FILE_SCHEME, (request) => {
		const url = new URL(request.url)

		// host 只用于构造合法 URL，真实路径全在 pathname 里
		if (url.host !== FILE_HOST) {
			return new Response("未知的协议 host", { status: 400 })
		}

		let filePath: string
		try {
			filePath = decodeURIComponent(url.pathname)
		} catch {
			return new Response("路径编码非法", { status: 400 })
		}

		const err = guard.Check(filePath)
		if (err !== null) {
			return new Response(err, { status: 403 })
		}

		return net.fetch(`file://${encodeURI(filePath)}`, {
			method: request.method,
			headers: request.headers
		})
	})
}


function createWindow(): void {
	const mainWindow = new BrowserWindow({
		width: 1400,
		height: 900,
		show: false,
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, "../preload/index.js"),
			// 渲染进程不开启 node 集成，一切能力经 preload 白名单暴露
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: false
		}
	})

	mainWindow.on("ready-to-show", () => {
		mainWindow.show()
	})

	if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
		mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"])
	} else {
		mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"))
	}
}


// killChildren 清理所有子进程。
//
// 翻译过程中会 spawn MinerU（Python）与 ollama，
// 若应用退出时不回收，它们会变成孤儿进程继续占用内存与写文件。
// 目前尚无子进程，先留出位置，接入翻译时补齐。
function killChildren(): void {
	// TODO(P0-翻译): 遍历并 kill 进程树
}


app.whenReady().then(() => {
	electronApp.setAppUserModelId("com.pdfmirror")

	const guard = new PathGuard()
	guard.Load(LoadWorkspaces())

	registerFileProtocol(guard)
	RegisterWorkspaceIPC(guard)

	app.on("browser-window-created", (_, window) => {
		optimizer.watchWindowShortcuts(window)
	})

	createWindow()

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow()
		}
	})
})

app.on("before-quit", () => {
	killChildren()
})

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit()
	}
})
