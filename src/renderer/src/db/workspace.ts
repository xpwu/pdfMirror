import { ClassArray } from "ts-json"

import { WorkspaceState } from "../../../shared/types"


// 工作区列表的内存状态。
//
// 沿用 api / db 分层：db 只负责持有状态，不关心数据从哪来。
export class Workspaces {
	Workspaces: WorkspaceState[] = new ClassArray(WorkspaceState)
}


let workspaces = new Workspaces()

export function GetWorkspaces(): Workspaces {
	return workspaces
}

export function SetWorkspaces(w: Workspaces): void {
	workspaces = w
}
