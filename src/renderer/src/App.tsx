import { useEffect, useState } from "react"

import { WorkspaceList } from "@/api/workspace"
import { GetWorkspaces } from "@/db/workspace"

import { WorkspaceState } from "../../../shared/types"


// 骨架验证页：拉取工作区列表，展示懒校验结果。
//
// 验证三件事：
//   1. IPC 链路通（window.api.WorkspaceList）
//   2. 铁律 L2 生效（中文根缺失只提示，绝不自动创建）
//   3. api / db 分层可用
export default function App() {
	const [list, setList] = useState<WorkspaceState[]>([])
	const [err, setErr] = useState<string>("")
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		WorkspaceList()
			.then((e) => {
				if (e !== null) {
					setErr(e.message)
					return
				}
				setList(GetWorkspaces().Workspaces)
			})
			.finally(() => setLoading(false))
	}, [])

	return (
		<div className="flex flex-col h-full p-6 gap-4">
			<h1 className="text-xl font-semibold">pdfMirror</h1>

			{loading && <p className="text-sm opacity-60">加载中…</p>}

			{err !== "" && (
				<p className="text-sm text-red-600">加载失败：{err}</p>
			)}

			{!loading && err === "" && list.length === 0 && (
				<p className="text-sm opacity-60">
					还没有工作区。请在数据库文件 workspaces.json 中手动添加。
				</p>
			)}

			<ul className="flex flex-col gap-2">
				{list.map((ws) => (
					<li key={ws.Config.SourceRoot} className="border rounded p-3">
						<div className="font-medium">{ws.Name}</div>
						<div className="text-xs opacity-60">
							{ws.Config.SourceRoot}
						</div>

						{!ws.SourceExists && (
							<div className="text-xs text-red-600 mt-1">
								英文根不存在
							</div>
						)}

						{!ws.TranslatedExists && (
							<div className="text-xs text-amber-600 mt-1">
								中文根不存在，请在磁盘上创建 {ws.Config.TranslatedRoot}
							</div>
						)}
					</li>
				))}
			</ul>
		</div>
	)
}
