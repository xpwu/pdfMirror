import { useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"

import { ReadFile } from "@/api/file"
import { SplitPages } from "@/lib/mdSplit"


// AI 翻译不可能搞定所有情况。
//
// 当译文与原文无法严格对应时，本组件的原则是：
// 按最可能的情况展示已有产物，同时明确告知用户原因，
// 并保留用户自行处理的余地 —— 是用户使用 AI，不是 AI 控制用户。


// 不联动的原因
export type DesyncReason = "none" | "no-markers" | "overflow"


const MARK_HINT = {
	none: "",
	"no-markers":
		"这份译文没有页码标记，无法与原文逐页对应。已按整篇显示，翻页联动已关闭。",
	overflow:
		"译文的页数多于原文，可能翻译时出了差错。已按整篇显示，翻页联动已关闭。"
}


// ResolveImagePath 把译文里的相对图片路径解析为绝对路径。
//
// 基准是译文 MD 所在的目录 —— 图片与译文同级（如 images_mineru/），
// 相对译文自身解析天然自洽。
//
// 外链与 data URI 不处理，返回空串交由 <img> 直接渲染。
function ResolveImagePath(mdAbsPath: string, src: string): string {
	if (src === "") return ""
	if (/^(https?:\/\/|data:|blob:|file:)/i.test(src)) return ""

	const idx = mdAbsPath.lastIndexOf("/")
	if (idx < 0) return ""

	const dir = mdAbsPath.slice(0, idx)

	return `${dir}/${src}`
}


function GuessMime(p: string): string {
	const e = p.toLowerCase()

	if (e.endsWith(".png")) return "image/png"
	if (e.endsWith(".jpg") || e.endsWith(".jpeg")) return "image/jpeg"
	if (e.endsWith(".gif")) return "image/gif"
	if (e.endsWith(".webp")) return "image/webp"
	if (e.endsWith(".svg")) return "image/svg+xml"

	return "application/octet-stream"
}


// Img 渲染译文中的图片。
//
// 图片不参与翻译，各版本共用，因此与译文同级存放。
// 经 ReadFile 取字节后转 blob URL —— 主进程侧过 PathGuard。
//
// 找不到时不静默失败：显示占位框并给出完整路径，
// 用户可据此自行检查文件是否缺失。
function Img({ src, alt }: { src?: string; alt?: string }) {
	const [url, setUrl] = useState("")
	const [err, setErr] = useState("")
	const [showPath, setShowPath] = useState(false)

	const abs = useMemo(() => {
		// mdAbsPath 由父级通过 context 注入式传入（见下方 components 配置）
		const base = MdPathRef.value
		if (!src || base === "") return src ? "" : ""
		return ResolveImagePath(base, src)
	}, [src])

	useEffect(() => {
		// 外链 / data URI 直接用，不走 IPC
		if (!src || abs === "") return

		let cancelled = false
		let blobUrl = ""

		ReadFile(abs).then(([bytes, e]) => {
			if (cancelled) return

			if (e !== null) {
				setErr(e)
				return
			}

			blobUrl = URL.createObjectURL(
				new Blob([bytes], { type: GuessMime(abs) })
			)
			setUrl(blobUrl)
		})

		return () => {
			cancelled = true
			if (blobUrl !== "") URL.revokeObjectURL(blobUrl)
		}
	}, [abs, src])

	if (err !== "") {
		return (
			<span className="inline-block border border-dashed border-amber-500 text-[11px] text-amber-700 rounded px-2 py-1 my-1">
				<span>图片缺失</span>
				<button
					className="ml-1 underline"
					onClick={() => setShowPath(!showPath)}
				>
					{showPath ? "隐藏路径" : "查看路径"}
				</button>
				{showPath && (
					<span className="block mt-1 break-all font-mono">{abs}</span>
				)}
				<span className="block text-neutral-500">{alt ?? ""}</span>
			</span>
		)
	}

	if (!src) return null

	if (abs === "") {
		// 外链或 data URI
		return (
			<img src={src} alt={alt ?? ""} className="max-w-full h-auto my-2" />
		)
	}

	if (url === "") {
		return (
			<span className="inline-block bg-black/5 rounded px-2 py-1 my-1 text-[11px] opacity-50">
				加载图片…
			</span>
		)
	}

	return (
		<img src={url} alt={alt ?? ""} className="max-w-full h-auto my-2" />
	)
}


// MdPathRef 传递当前译文的绝对路径给 Img 组件。
//
// react-markdown 的 components 配置不支持直接传自定义 prop，
// 用一个轻量 ref 传递，避免为此引入 Context。
const MdPathRef: { value: string } = { value: "" }


export default function MdView({
	md,
	mdAbsPath,
	pdfPages
}: {
	md: string
	mdAbsPath: string
	pdfPages: number
}) {
	const containerRef = useRef<HTMLDivElement>(null)
	const [toast, setToast] = useState("")

	MdPathRef.value = mdAbsPath

	const split = useMemo(() => SplitPages(md), [md])

	// 判断是否与原文联动。
	//
	// 两种情况不联动：
	//   1. 没有任何切页标记 —— 无法定位页码
	//   2. 译文页数超出 PDF 页数 —— 译文可能有问题，
	//      此时此前「译文与原文页数相同」的前提不成立，
	//      联动必然错位，不如明确关闭并告知用户
	const reason: DesyncReason =
		!split.HasMarkers
			? "no-markers"
			: pdfPages > 0 && split.MaxPage > pdfPages
				? "overflow"
				: "none"

	const desync = reason !== "none"

	// 联动时按页渲染；不联动时整篇渲染，不切页
	const pages = useMemo(() => {
		if (!desync) return split.Pages
		return [{ Page: 1, Content: md }]
	}, [desync, split.Pages, md])


	// 公式交互：点击复制 LaTeX 源码。
	//
	// 公式渲染成 KaTeX 后，源码仍保留在 rehype-katex 生成的
	// <annotation encoding="application/x-tex"> 里。渲染完成后提取出来，
	// 让用户随时能查到原文 —— 展示可以美化，原文必须可查。
	useEffect(() => {
		const root = containerRef.current
		if (root === null) return

		for (const el of root.querySelectorAll<HTMLElement>(".katex")) {
			const ann = el.querySelector(
				'annotation[encoding="application/x-tex"]'
			)

			if (ann === null) continue

			const tex = ann.textContent ?? ""
			if (tex === "") continue

			el.dataset.tex = tex
			el.classList.add("pm-formula")
			el.title = "点击查看 / 复制公式原文"
		}

		const onClick = (e: MouseEvent): void => {
			const t = e.target as HTMLElement | null
			if (t === null) return

			const f = t.closest(".pm-formula") as HTMLElement | null
			if (f === null) return

			const tex = f.dataset.tex ?? ""
			if (tex === "") return

			void navigator.clipboard.writeText(tex).then(() => {
				setToast("公式原文已复制")
				setTimeout(() => setToast(""), 1500)
			})
		}

		root.addEventListener("click", onClick)

		return () => root.removeEventListener("click", onClick)
	}, [md, pages])


	return (
		<div className="h-full overflow-y-auto relative">
			{/* 不联动提示：说明原因，让用户知道发生了什么 */}
			{desync && (
				<div className="sticky top-0 z-10 bg-amber-50 border-b border-amber-300 text-amber-800 text-xs px-4 py-2">
					{MARK_HINT[reason]}
				</div>
			)}

			{toast !== "" && (
				<div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-50 bg-neutral-900 text-white text-xs px-3 py-1 rounded">
					{toast}
				</div>
			)}

			<div ref={containerRef} className="p-4 text-sm leading-relaxed">
				{pages.map((p) => (
					<section
						key={p.Page}
						// data-page 与中栏 PDF 一致，锚点对齐依赖它
						data-page={p.Page}
						className={
							desync
								? ""
								: "border-b border-black/5 pb-4 mb-4 last:border-b-0"
						}
					>
						{desync ? (
							<div className="prose-sm">
								<ReactMarkdown
									remarkPlugins={[remarkGfm, remarkMath]}
									rehypePlugins={[
										[rehypeKatex, { throwOnError: false }]
									]}
									components={{ img: Img }}
								>
									{p.Content}
								</ReactMarkdown>
							</div>
						) : (
							<>
								<div className="text-[10px] opacity-40 mb-1 select-none">
									{p.Page}
								</div>

								{p.Content.trim() === "" ? (
									// 缺页：留空并说明，保持页码对齐
									<div className="text-xs text-neutral-400 italic py-3">
										本页译文缺失
									</div>
								) : (
									<div className="prose-sm">
										<ReactMarkdown
											remarkPlugins={[
												remarkGfm,
												remarkMath
											]}
											rehypePlugins={[
												[
													rehypeKatex,
													{ throwOnError: false }
												]
											]}
											components={{ img: Img }}
										>
											{p.Content}
										</ReactMarkdown>
									</div>
								)}
							</>
						)}
					</section>
				))}
			</div>
		</div>
	)
}
