import { useEffect, useState } from "react"

import { WorkspaceList } from "@/api/workspace"
import { GetWorkspaces } from "@/db/workspace"
import { WorkspaceTree } from "@/api/tree"
import { GetTree } from "@/db/tree"

import { FileURL } from "../../shared/channels"
import { TreeNode, WorkspaceState } from "../../shared/types"


// 目录默认展开到第几层。
//
// 层级编号：工作区为 0，其下的目录/文件为 1，依此类推。
// 目录节点的 depth 小于等于此值时默认展开，更深的默认折叠。
// 设 1 表示：展开工作区后，第一层目录也展开，可直接看到其中的 PDF。
const DEFAULT_EXPAND_DEPTH = 1


// 骨架页面：左栏目录/文件树，中栏原文，右栏译文。
//
// 左栏选中哪个文件，中栏就显示它的原文，右栏显示它的译文。
// 三组数据一一对应，没有中间层。
export default function App() {
	const [wss, setWss] = useState<WorkspaceState[]>([])
	const [wsErr, setWsErr] = useState<string>("")

	// 每个工作区的树，key 为 SourceRoot
	const [trees, setTrees] = useState<Record<string, TreeNode[]>>({})

	// 展开的节点，key 见 nodeKey
	const [expanded, setExpanded] = useState<Set<string>>(new Set())

	const [curWs, setCurWs] = useState<WorkspaceState | null>(null)
	const [curPaper, setCurPaper] = useState<TreeNode | null>(null)

	useEffect(() => {
		WorkspaceList()
			.then((e) => {
				if (e !== null) {
					setWsErr(e.message)
					return
				}

				const list = GetWorkspaces().Workspaces
				setWss(list)

				// 工作区默认展开，故初始即加载各工作区的树。
				// 本地场景工作区数量很少，全量加载代价可忽略。
				setExpanded(new Set(list.map((w) => wsKey(w))))
				void loadTrees(list)
			})
	}, [])

	async function loadTrees(list: WorkspaceState[]): Promise<void> {
		await Promise.all(
			list
				.filter((w) => w.SourceExists)
				.map(async (w) => {
					const e = await WorkspaceTree(w.Config.SourceRoot)
					if (e !== null) {
						return
					}

					const t = GetTree()
					setTrees((prev) => ({
						...prev,
						[t.SourceRoot]: t.Nodes
					}))
				})
		)
	}

	function toggle(key: string): void {
		setExpanded((prev) => {
			const next = new Set(prev)
			if (next.has(key)) {
				next.delete(key)
			} else {
				next.add(key)
			}
			return next
		})
	}

	function pick(ws: WorkspaceState, paper: TreeNode): void {
		setCurWs(ws)
		setCurPaper(paper)
	}

	// 原文与译文的完整路径，供 pm:// 协议读取
	const sourcePath =
		curWs !== null && curPaper !== null
			? `${curWs.Config.SourceRoot}/${curPaper.Rel}`
			: ""

	return (
		<div className="flex h-screen text-sm">
			{/* ── 左栏：目录 / 文件树 ── */}
			<aside className="w-64 shrink-0 border-r overflow-y-auto p-2">
				<div className="font-semibold px-1 pb-2">工作区</div>

				{wsErr !== "" && (
					<p className="text-red-600 text-xs px-1">加载失败：{wsErr}</p>
				)}

				{wss.length === 0 && wsErr === "" && (
					<p className="text-xs opacity-60 px-1">
						还没有工作区，请在 .dev-data/workspaces.json 中添加
					</p>
				)}

				<ul>
					{wss.map((ws) => (
						<li key={ws.Config.SourceRoot}>
							<button
								className="w-full text-left flex items-center gap-1 rounded px-1 py-0.5 hover:bg-black/5"
								onClick={() => toggle(wsKey(ws))}
							>
								<span className="opacity-50 shrink-0">
									{expanded.has(wsKey(ws)) ? "▾" : "▸"}
								</span>
								<span className="truncate">{ws.Name}</span>
								{!ws.TranslatedExists && (
									<span
										className="text-amber-600 shrink-0"
										title={`中文根不存在：${ws.Config.TranslatedRoot}`}
									>
										⚠
									</span>
								)}
							</button>

							{expanded.has(wsKey(ws)) && (
								<ul>
									{(trees[ws.Config.SourceRoot] ?? []).map((n) => (
										<Node
											key={n.Rel}
											node={n}
											depth={1}
											ws={ws}
											cur={curPaper}
											onToggle={toggle}
											onPick={pick}
										/>
									))}
								</ul>
							)}
						</li>
					))}
				</ul>
			</aside>

			{/* ── 中栏：原文 PDF ── */}
			<section className="flex-1 min-w-0 overflow-y-auto p-4">
				{curPaper === null && (
					<p className="text-xs opacity-60">请从左侧选择一篇论文</p>
				)}

				{curPaper !== null && (
					<div className="flex flex-col gap-1">
						<div className="font-semibold">{curPaper.Name}</div>
						<div className="text-xs opacity-60 break-all">
							{FileURL(sourcePath)}
						</div>
						<div className="mt-4 text-xs opacity-60">
							PDF 渲染待接入（pdf.js）
						</div>
					</div>
				)}
			</section>

			{/* ── 右栏：译文 ── */}
			<section className="flex-1 min-w-0 relative border-l overflow-hidden">
				{/* 版本选择器：悬浮右上角，不占顶部高度。
				    放在滚动容器之外，故不会随内容滚动。 */}
				{curPaper?.HasTranslated === true && (
					<div className="absolute top-3 right-3 z-10">
						<button className="rounded border bg-white/90 px-2 py-1 text-xs shadow backdrop-blur">
							版本 ▾
						</button>
					</div>
				)}

				<div className="h-full overflow-y-auto p-4">
					{curWs?.TranslatedExists === false && (
						<p className="text-xs text-amber-600 mb-3">
							中文根不存在，请在磁盘上创建 {curWs.Config.TranslatedRoot}
						</p>
					)}

					{curPaper === null && (
						<p className="text-xs opacity-60">请从左侧选择一篇论文</p>
					)}

					{curPaper !== null && !curPaper.HasTranslated && (
						<div className="flex flex-col gap-2">
							<div className="font-semibold">{curPaper.Name}</div>
							<p className="text-xs opacity-60">还没有译文</p>
							<button
								className="self-start rounded bg-blue-600 px-3 py-1 text-xs text-white"
								disabled={curWs?.TranslatedExists === false}
							>
								马上翻译
							</button>
						</div>
					)}

					{curPaper !== null && curPaper.HasTranslated && (
						<div className="text-xs opacity-60">
							译文渲染待接入（按 &lt;!-- page:N --&gt; 切页）
						</div>
					)}
				</div>
			</section>
		</div>
	)
}


// Node 递归渲染树的一个节点。
//
// 目录可折叠，文件可点选。两者混排，一直显示到文件。
// 目录的展开状态由组件自身持有，初始展开深度见 DEFAULT_EXPAND_DEPTH。
function Node({
	node,
	depth,
	ws,
	cur,
	onToggle,
	onPick
}: {
	node: TreeNode
	depth: number
	ws: WorkspaceState
	cur: TreeNode | null
	onToggle: (key: string) => void
	onPick: (ws: WorkspaceState, node: TreeNode) => void
}) {
	const [open, setOpen] = useState(depth <= DEFAULT_EXPAND_DEPTH)

	const selected = cur !== null && cur.Rel === node.Rel && cur.Name === node.Name

	if (node.IsDir) {
		return (
			<li>
				<button
					className="w-full text-left flex items-center gap-1 rounded px-1 py-0.5 hover:bg-black/5"
					style={{ paddingLeft: depth * 12 }}
					onClick={() => setOpen(!open)}
				>
					<span className="opacity-50 shrink-0">{open ? "▾" : "▸"}</span>
					<span className="truncate">{node.Name}</span>
				</button>

				{open && node.Children.length > 0 && (
					<ul>
						{node.Children.map((c) => (
							<Node
								key={c.Rel}
								node={c}
								depth={depth + 1}
								ws={ws}
								cur={cur}
								onToggle={onToggle}
								onPick={onPick}
							/>
						))}
					</ul>
				)}
			</li>
		)
	}

	return (
		<li>
			<button
				className={`w-full text-left flex items-center gap-1 rounded px-1 py-0.5 ${
					selected ? "bg-blue-100 text-blue-700" : "hover:bg-black/5"
				}`}
				style={{ paddingLeft: depth * 12 + 16 }}
				onClick={() => onPick(ws, node)}
			>
				<span className="truncate">{node.Name}</span>
				{node.HasTranslated && (
					<span className="text-xs opacity-50 shrink-0">译</span>
				)}
			</button>
		</li>
	)
}


// wsKey 工作区节点的展开状态 key
function wsKey(ws: WorkspaceState): string {
	return `ws:${ws.Config.SourceRoot}`
}
