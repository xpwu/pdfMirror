import { app, BrowserWindow } from "electron"
import { electronApp, optimizer, is } from "@electron-toolkit/utils"
import path from "node:path"

import { PathGuard } from "./service/pathGuard"
import { LoadWorkspaces } from "./service/workspace"
import { Register as RegisterWorkspaceIPC } from "./ipc/workspace"
import { Register as RegisterFileIPC } from "./ipc/file"
import { Register as RegisterPaperIPC } from "./ipc/paper"


// 向渲染进程暴露 gc()，供内存调试用。
app.commandLine.appendSwitch("js-flags", "--expose-gc")


function createWindow(): void {
	const mainWindow = new BrowserWindow({
		width: 1400,
		height: 900,
		show: false,
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, "../preload/index.js"),
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: false
		}
	})

	mainWindow.on("ready-to-show", () => {
		mainWindow.show()

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


function killChildren(): void {
	// TODO(P0-翻译): 遍历并 kill 进程树
}


app.whenReady().then(() => {
	electronApp.setAppUserModelId("com.pdfmirror")

	// PathGuard 是所有本地文件访问的安全边界，铁律 L1/L2/L3 全部落在它身上。
	const guard = new PathGuard()
	guard.Load(LoadWorkspaces())

	RegisterWorkspaceIPC(guard)
	RegisterFileIPC(guard)
	RegisterPaperIPC(guard)

	app.on("browser-window-created", (_, window) => {
		optimizer.watchWindowShortcuts(window)
	})

	createWindow()

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow()
	})
})

app.on("before-quit", () => {
	killChildren()
})

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit()
})
