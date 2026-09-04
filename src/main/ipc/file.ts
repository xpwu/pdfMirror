import { ipcMain } from "electron"
import fs from "node:fs"

import { CH } from "../../shared/channels"
import { IPCResult } from "../../shared/types"
import { PathGuard } from "../service/pathGuard"


// Register 注册文件读取相关的 IPC handler。
//
// 用 IPC 直传字节而非自定义协议：
//   1. 绕开 dev 模式下的跨源 CORS 问题
//   2. 调用方本就整文件读取，Range 分片无收益
//   3. Electron 的结构化克隆对 Uint8Array 是零拷贝，
//      几 MB 的 PDF 传递开销可忽略
//
// 安全不变：依然先过 PathGuard，这是本地文件访问的唯一入口。
export function Register(guard: PathGuard): void {
	ipcMain.handle(
		CH.FileRead,
		async (_event, absPath: string): Promise<IPCResult<Uint8Array>> => {
			console.error(`[file] 收到请求: ${absPath}`)

			if (typeof absPath !== "string" || absPath === "") {
				return [new Uint8Array(), "入参路径非法"]
			}

			const err = guard.Check(absPath)
			if (err !== null) {
				console.error(`[file] 拒绝访问: ${err}`)
				return [new Uint8Array(), err]
			}

			try {
				const buf = await fs.promises.readFile(absPath)
				console.error(`[file] 返回 ${buf.length} 字节`)
				return [new Uint8Array(buf), null]
			} catch (e) {
				const msg = `读取失败: ${absPath} (${String(e)})`
				console.error(`[file] ${msg}`)
				return [new Uint8Array(), msg]
			}
		}
	)
}
