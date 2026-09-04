import { ipcMain } from "electron"

import { CH } from "../../shared/channels"
import { IPCResult, WorkspaceState } from "../../shared/types"
import { PathGuard } from "../service/pathGuard"
import { LoadWorkspaces, Validate } from "../service/workspace"


// Register 注册工作区相关的 IPC handler。
//
// handler 只做三件事：调 service、包成 IPCResult、返回。
// 业务逻辑一律留在 service 里，保持这里足够薄。
export function Register(guard: PathGuard): void {
	// 工作区列表（含中文根懒校验结果）
	ipcMain.handle(CH.WorkspaceList, (): IPCResult<WorkspaceState[]> => {
		const configs = LoadWorkspaces()

		guard.Load(configs)

		const states: WorkspaceState[] = []
		for (const cfg of configs) {
			states.push(Validate(cfg))
		}

		return [states, null]
	})
}
