import { useCallback, useEffect, useState } from "react"
import path from "path-browserify"

import { WorkspaceList } from "@/api/workspace"
import { GetWorkspaces } from "@/db/workspace"
import { WorkspaceTree } from "@/api/tree"
import { GetTree } from "@/db/tree"
import { PaperVersions, LoadTranslation } from "@/api/paper"
import { GetPaper } from "@/db/paper"

import MemoryBar from "@/components/MemoryBar"
import PdfView from "@/components/PdfView"
import MdView from "@/components/MdView"
import VersionFloat from "@/components/VersionFloat"

import {
	PaperVersion,
	TreeNode,
	WorkspaceState
} from "../../shared/types"


// 目录默认展开到第几层：工作区为 0，其下目录/文件为 1。
// 设为 1 表示展开工作区后，第一层目录也展开，可直接看到 PDF。
const DEFAULT_EXPAND_DEPTH = 1


export default function App() {
	const [wss, setWss] = useState<WorkspaceState[]>([])
	const [wsErr, setWsErr] = useState<string>("")

	const [trees, setTrees] = useState<Record<string, TreeNode[]>>({})
	const [expanded, setExpanded] = useState<Set<string>>(new Set())

	const [curWs, setCurWs] = useState<WorkspaceState | null>(null)
	const [curPaper, setCurPaper] = useState<TreeNode | null>(null)

	// 原文路径与页数
	const [sourcePath, setSourcePath] = useState("")
	const [pdfPages, setPdfPages] = useState(0)

	// 译文
	const [versions, setVersions] = useState<PaperVersion[]>([])
	const [curModel, setCurModel] = useState("")
	const [md, setMd] = useState("")
	const [mdAbsPath, setMdAbsPath] = useState("")
	const [transErr, setTransErr] = useState("")


	useEffect(() => {
		WorkspaceList()
			.then((e) => {
				if (e !== null) {
					setWsErr(e.message)
					return
				}

				const list = GetWorkspaces().Workspaces
				setWss(list)
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
					if (e !== null) return

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
			if (next.has(key)) next.delete(key)
			else next.add(key)
			return next
		})
	}

	// resetTrans 清空译文相关状态
	function resetTrans(): void {
		setVersions([])
		setCurModel("")
		setMd("")
		setMdAbsPath("")
		setTransErr("")
	}

	const onPageCount = useCallback((n: number) => {
		setPdfPages(n)
	}, [])

	async function pick(ws: WorkspaceState, paper: TreeNode): Promise<void> {
		setCurWs(ws)
		setCurPaper(paper)
		setSourcePath(`${ws.Config.SourceRoot}/${paper.Rel}`)
		setPdfPages(0)
		resetTrans()

		// 中文根不存在：错误显示在译文区（用户决策 3）
		if (!ws.TranslatedExists) return

		const e = await PaperVersions(ws.Config.SourceRoot, paper.Rel)
		if (e !== null) {
			setTransErr(e.message)
			return
		}

		const p = GetPaper()

		// 论文已切换则丢弃这次结果
		if (p.Rel !== paper.Rel) return

		if (p.Versions.length === 0) return

		setVersions(p.Versions)

		// 默认选最近修改的（列表已按 ModifiedAt 倒序）
		await loadVersion(ws, paper, p.Versions[0])
	}

	async function loadVersion(
		ws: WorkspaceState,
		paper: TreeNode,
		v: PaperVersion
	): Promise<void> {
		// 译文绝对路径：中文根 + rel 去扩展名 + 文件名
		const rel = paper.Rel
		const ext = path.posix.extname(rel)
		const dirRel = rel.slice(0, rel.length - ext.length)

		const abs = path.posix.join(
			ws.TranslatedRoot,
			dirRel,
			v.FileName
		)

		const e = await LoadTranslation(abs, v.Model)
		if (e !== null) {
			setTransErr(e.message)
			return
		}

		if (curPaper?.Rel !== paper.Rel) return

		setCurModel(v.Model)
		setMd(GetPaper().Content)
		setMdAbsPath(abs)
		setTransErr("")
	}

	return (
		<div className="flex h-screen text-sm">
			<MemoryBar />

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
										title={`中文根不存在：${ws.TranslatedRoot}`}
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
											onPick={(w, p) => void pick(w, p)}
										/>
									))}
								</ul>
							)}
						</li>
					))}
				</ul>
			</aside>

			{/* ── 中栏：原文 PDF ── */}
			<section className="flex-1 min-w-0 overflow-hidden">
				{curPaper === null ? (
					<p className="text-xs opacity-60 p-4">请从左侧选择一篇论文</p>
				) : (
					<PdfView absPath={sourcePath} onPageCount={onPageCount} />
				)}
			</section>

			{/* ── 右栏：译文 ── */}
			<section className="flex-1 min-w-0 relative border-l overflow-hidden">
				<VersionFloat
					versions={versions}
					cur={curModel}
					onPick={(m) => {
						const v = versions.find((x) => x.Model === m)
						if (v === undefined || curWs === null || curPaper === null)
							return
						void loadVersion(curWs, curPaper, v)
					}}
				/>

				{curPaper === null && (
					<div className="p-4 text-xs opacity-60">
						请从左侧选择一篇论文
					</div>
				)}

				{curPaper !== null && curWs !== null && !curWs.TranslatedExists && (
					<div className="p-4 text-xs text-amber-700">
						中文根不存在，请在磁盘上创建：
						<div className="mt-1 font-mono break-all">
							{curWs.TranslatedRoot}
						</div>
					</div>
				)}

				{curPaper !== null &&
					curWs?.TranslatedExists === true &&
					transErr !== "" && (
						<div className="p-4 text-xs text-red-600 break-all">
							{transErr}
						</div>
					)}

				{curPaper !== null &&
					curWs?.TranslatedExists === true &&
					transErr === "" &&
					versions.length === 0 && (
						<div className="p-4 flex flex-col gap-2">
							<div className="font-semibold">{curPaper.Name}</div>
							<p className="text-xs opacity-60">还没有翻译内容</p>
							<button
								className="self-start text-xs text-blue-600"
								title="翻译功能开发中"
							>
								马上翻译
							</button>
						</div>
					)}

				{curPaper !== null &&
					curWs?.TranslatedExists === true &&
					transErr === "" &&
					versions.length > 0 &&
					md !== "" && (
						<MdView
							md={md}
							mdAbsPath={mdAbsPath}
							pdfPages={pdfPages}
						/>
					)}
			</section>
		</div>
	)
}


function Node({
	node,
	depth,
	ws,
	cur,
	onPick
}: {
	node: TreeNode
	depth: number
	ws: WorkspaceState
	cur: TreeNode | null
	onPick: (ws: WorkspaceState, node: TreeNode) => void
}) {
	const [open, setOpen] = useState(depth <= DEFAULT_EXPAND_DEPTH)

	const selected =
		cur !== null && cur.Rel === node.Rel && cur.Name === node.Name

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


function wsKey(ws: WorkspaceState): string {
	return `ws:${ws.Config.SourceRoot}`
}
