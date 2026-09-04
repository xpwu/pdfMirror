import { Json } from "ts-json"

import { SetWorkspaces, Workspaces as DBWorkspaces } from "@/db/workspace"


// WorkspaceList 拉取工作区列表并写入内存 db。
//
// IPC 返回的是结构化克隆后的普通对象，需要经 ts-json 还原成
// 带原型的 class 实例，否则 class 上的方法会丢失。
export async function WorkspaceList(): Promise<Error | null> {
	const [ret, err] = await window.api.WorkspaceList()
	if (err !== null) {
		return new Error(err)
	}

	const [m, err2] = new Json().fromJson(
		JSON.stringify({ Workspaces: ret }),
		DBWorkspaces
	)
	if (err2 !== null) {
		return err2
	}

	SetWorkspaces(m)

	return null
}
