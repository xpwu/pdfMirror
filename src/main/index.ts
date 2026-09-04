import { app, BrowserWindow } from "electron"
import { electronApp, optimizer, is } from "@electron-toolkit/utils"
import path from "node:path"

import { PathGuard } from "./service/pathGuard"
import { LoadWorkspaces } from "./service/workspace"
import { Register as RegisterWorkspaceIPC } from "./ipc/workspace"
import { Register as RegisterFileIPC } from "./ipc/file"


// 向渲染进程暴露 gc()。
//
// 判断内存是否真回落，必须能主动触发 GC：
// Chromium 的 GC 是惰性的，不触发时 JS 堆里混着可回收的垃圾，
// 无法区分「泄漏」与「尚未回收」。
//
// 必须在 app ready 之前调用。
app.commandLine.appendSwitch("js-flags", "--expose-gc")


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

		// dev 下自动打开 DevTools。
		//
		// macOS 上 F12 默认映射为音量键（需 Fn+F12），
		// 且 Cmd+Opt+I 要应用定义菜单才生效 —— 与其依赖快捷键，
		// 不如直接打开。调试完可把这里注掉。
		if (is.dev && !mainWindow.webContents.isDevToolsOpened()) {
			mainWindow.webContents.openDevTools({ mode: "bottom" })
		}
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

	// PathGuard 是所有本地文件访问的安全边界，铁律 L1/L2/L3 全部落在它身上。
	// 此处统一载入工作区配置，后续各 IPC handler 直接复用。
	const guard = new PathGuard()
	guard.Load(LoadWorkspaces())

	RegisterWorkspaceIPC(guard)
	RegisterFileIPC(guard)

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
