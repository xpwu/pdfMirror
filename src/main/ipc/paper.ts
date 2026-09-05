import { ipcMain } from "electron"

import { CH } from "../../shared/channels"
import { IPCResult, PaperVersion } from "../../shared/types"
import { PathGuard } from "../service/pathGuard"
import { ScanVersions } from "../service/version"
import { LoadWorkspaces } from "../service/workspace"


// Register 注册论文相关的 IPC handler。
export function Register(guard: PathGuard): void {
	// 某篇论文的所有译文版本
	ipcMain.handle(
		CH.PaperVersions,
		(
			_event,
			sourceRoot: string,
			rel: string
		): IPCResult<PaperVersion[]> => {
			if (typeof sourceRoot !== "string" || sourceRoot === "") {
				return [[], "入参 SourceRoot 非法"]
			}
			if (typeof rel !== "string" || rel === "") {
				return [[], "入参 Rel 非法"]
			}

			const configs = LoadWorkspaces()
			guard.Load(configs)

			const cfg = configs.find((c) => c.SourceRoot === sourceRoot)
			if (cfg === undefined) {
				return [[], `工作区不存在: ${sourceRoot}`]
			}

			// 没有译文不是错误，返回空列表即可
			return [ScanVersions(cfg, rel), null]
		}
	)
}
