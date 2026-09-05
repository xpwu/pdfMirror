import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type * as pdfjs from "pdfjs-dist"

import { ReadFile } from "@/api/file"
import { OpenDocument } from "@/lib/pdfLoader"
import { TrackPage, UntrackAll, UntrackPage } from "@/lib/bitmapMem"

const DEFAULT_SCALE = 1.25
const SCALES = [0.75, 1, 1.25, 1.5, 2]
const MAX_DPR = 2
const PAGE_GAP = 16
const BUFFER_PAGES = 2
const KEEP_MARGIN = 4

// 定位完问题后把这里改为 false 即可关闭日志
const DEBUG = true

function log(msg: string): void {
	if (DEBUG) console.log(`[PdfView] ${msg}`)
}

interface PageSize {
	w: number
	h: number
}

export default function PdfView({
	absPath,
	onPageCount
}: {
	absPath: string
	// 页数变化时通知父级。
	//
	// 右栏需要知道原文页数，才能判断译文是否超出、
	// 从而决定是否启用逐页联动。
	onPageCount?: (n: number) => void
}) {
	const scrollRef = useRef<HTMLDivElement>(null)
	const wrappersRef = useRef<(HTMLDivElement | null)[]>([])
	const renderedRef = useRef<Set<number>>(new Set())
	const renderingRef = useRef<Set<number>>(new Set())
	const tasksRef = useRef<Map<number, pdfjs.RenderTask>>(new Map())

	const reqRef = useRef(0)

	// generation：每次加载新文档自增。
	//
	// 用它而不是「比对 doc 引用」来作废旧渲染：
	// renderPage 里读到的 docRef.current 就是当前文档，
	// 比对引用永远相等，守卫形同虚设。
	const genRef = useRef(0)

	const docRef = useRef<pdfjs.PDFDocumentProxy | null>(null)
	const chainRef = useRef<Promise<unknown>>(Promise.resolve())

	const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
	const [sizes, setSizes] = useState<PageSize[]>([])
	const [scale, setScale] = useState(DEFAULT_SCALE)
	const [err, setErr] = useState<string>("")

	const offsets = useMemo(() => {
		const arr: number[] = [0]
		let acc = 0
		for (const s of sizes) {
			arr.push(acc)
			acc += s.h + PAGE_GAP
		}
		return arr
	}, [sizes])

	const totalHeight = useMemo(() => {
		if (sizes.length === 0) return 0
		const last = offsets[offsets.length - 1]
		return last + sizes[sizes.length - 1].h + PAGE_GAP
	}, [sizes, offsets])

	// releaseAll 释放当前所有位图并取消所有在途任务。
	//
	// 这是唯一的销毁入口，切换文档、缩放变化、卸载都必须走它。
	// 三个动作缺一不可：
	//   1. cancel 任务   —— 否则 pdf.js 一直持有算子列表
	//   2. 置零 canvas   —— 否则位图内存不释放
	//   3. 清记录        —— 必须在前两步之后
	const releaseAll = useCallback(() => {
		for (const [, task] of tasksRef.current) {
			try {
				void task.cancel()
			} catch {
				// 已完成的任务 cancel 会抛错，忽略
			}
		}
		tasksRef.current.clear()
		renderingRef.current.clear()

		for (const el of wrappersRef.current) {
			if (el === null || el === undefined) continue
			const canvas = el.querySelector("canvas")
			if (canvas !== null) {
				canvas.width = 0
				canvas.height = 0
				canvas.remove()
			}
		}

		renderedRef.current.clear()
		UntrackAll()

		log(`releaseAll：位图归零，剩余 ${document.querySelectorAll("canvas").length} 个 canvas`)
	}, [])

	const destroyPage = useCallback((i: number) => {
		const task = tasksRef.current.get(i)
		if (task !== undefined) {
			try {
				void task.cancel()
			} catch {
				// 忽略
			}
			tasksRef.current.delete(i)
		}

		const wrapper = wrappersRef.current[i]
		if (wrapper === null || wrapper === undefined) return

		const canvas = wrapper.querySelector("canvas")
		if (canvas !== null) {
			canvas.width = 0
			canvas.height = 0
			canvas.remove()
		}

		renderedRef.current.delete(i)
		UntrackPage(i)
	}, [])

	const renderPage = useCallback(
		async (i: number) => {
			if (renderedRef.current.has(i) || renderingRef.current.has(i)) return

			const d = docRef.current
			if (d === null) return

			const gen = genRef.current
			renderingRef.current.add(i)

			try {
				const page = await d.getPage(i)

				// generation 变了说明文档已切换，放弃本次渲染
				if (genRef.current !== gen || docRef.current !== d) {
					page.cleanup()
					return
				}

				// 位图按 devicePixelRatio 放大绘制，再用 CSS 尺寸缩回逻辑像素。
				// 否则 Retina 屏上一个逻辑像素只对应一个位图像素，文字发虚。
				const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
				const viewport = page.getViewport({ scale: scale * dpr })

				const canvas = document.createElement("canvas")
				canvas.width = Math.floor(viewport.width)
				canvas.height = Math.floor(viewport.height)
				canvas.style.width = `${Math.floor(viewport.width / dpr)}px`
				canvas.style.height = `${Math.floor(viewport.height / dpr)}px`

				const wrapper = wrappersRef.current[i]

				if (
					wrapper === null ||
					wrapper === undefined ||
					genRef.current !== gen ||
					docRef.current !== d
				) {
					page.cleanup()
					canvas.width = 0
					canvas.height = 0
					return
				}

				wrapper.textContent = ""
				wrapper.appendChild(canvas)

				// 记账：这一页的位图字节。
				// 位图内存不在 JS 堆里，只能自己记，
				// 销毁时由 destroyPage / releaseAll 扣减。
				TrackPage(i, canvas.width * canvas.height * 4)

				const ctx = canvas.getContext("2d")
				if (ctx === null) {
					page.cleanup()
					return
				}

				const task = page.render({ canvas, viewport })
				tasksRef.current.set(i, task)

				await task.promise
				tasksRef.current.delete(i)

				page.cleanup()

				// 渲染完成时文档可能已切换，此时不能标记为已渲染，
				// 否则新文档会误认为这些页已经画好
				if (genRef.current === gen && docRef.current === d) {
					renderedRef.current.add(i)
				}
			} catch (e) {
				const msg = String(e)
				if (!msg.includes("RenderingCancelledException")) {
					log(`第 ${i} 页渲染异常: ${msg}`)
				}
			} finally {
				renderingRef.current.delete(i)
			}
		},
		[scale]
	)

	const renderVisible = useCallback(() => {
		const el = scrollRef.current
		if (el === null || sizes.length === 0) return

		const top = el.scrollTop
		const bottom = top + el.clientHeight

		let first = 1
		for (let i = 1; i < offsets.length; i++) {
			if (offsets[i] <= top) first = i
			else break
		}

		let last = first
		for (let i = first; i < offsets.length; i++) {
			if (offsets[i] < bottom) last = i
			else break
		}

		const start = Math.max(1, first - BUFFER_PAGES)
		const end = Math.min(sizes.length, last + BUFFER_PAGES)

		for (let i = start; i <= end; i++) {
			const page = i
			chainRef.current = chainRef.current.then(
				() => renderPage(page),
				() => renderPage(page)
			)
		}

		const keepStart = Math.max(1, first - BUFFER_PAGES - KEEP_MARGIN)
		const keepEnd = Math.min(
			sizes.length,
			last + BUFFER_PAGES + KEEP_MARGIN
		)

		for (const i of Array.from(renderedRef.current)) {
			if (i < keepStart || i > keepEnd) {
				destroyPage(i)
			}
		}
	}, [sizes, offsets, renderPage, destroyPage])

	// ── 加载文档 ──
	useEffect(() => {
		const id = ++reqRef.current
		const gen = ++genRef.current
		let cancelled = false

		log(`id=${id} gen=${gen} 开始加载 ${absPath}`)

		setErr("")
		setSizes([])
		setDoc(null)

		// 注意：这里不再做清理。
		//
		// 上一轮 effect 的 cleanup 已经在本 effect 运行前执行完毕，
		// 那才是销毁旧内容的正确位置。在此处 clear 只会丢掉记录
		// 而不释放位图 —— 正是之前内存回不到基线的主因。

		async function load(): Promise<void> {
			const [bytes, e] = await ReadFile(absPath)
			if (cancelled || id !== reqRef.current) return

			if (e !== null) {
				setErr(e)
				return
			}

			let opened: pdfjs.PDFDocumentProxy
			try {
				opened = await OpenDocument(bytes)
			} catch (ex) {
				if (!cancelled && id === reqRef.current) {
					setErr(String(ex))
				}
				return
			}

			if (cancelled || id !== reqRef.current) return

			docRef.current = opened

			const list: PageSize[] = []
			for (let i = 1; i <= opened.numPages; i++) {
				if (cancelled || id !== reqRef.current) return

				try {
					const page = await opened.getPage(i)
					const vp = page.getViewport({ scale })
					list.push({
						w: Math.floor(vp.width),
						h: Math.floor(vp.height)
					})
					page.cleanup()
				} catch {
					list.push({ w: 0, h: 0 })
				}
			}

			if (cancelled || id !== reqRef.current) return

			setSizes(list)
			setDoc(opened)
			onPageCount?.(list.length)
			log(`id=${id} gen=${gen} 就绪 ${opened.numPages} 页`)
		}

		void load()

		return () => {
			cancelled = true

			// ── 关键：切换文档前彻底销毁上一份 ──
			//
			// 必须在 OpenDocument 之前完成 cancel 任务 + 释放位图，
			// 否则 pdfLoader 销毁文档时仍有渲染在飞，
			// pdf.js 会抛错或只做部分清理 —— 两种情况都泄漏。
			releaseAll()
			wrappersRef.current = []

			log(`id=${id} gen=${gen} cleanup：已释放全部位图与任务`)
		}
		// onPageCount 由父级传入，加入依赖避免闭包拿到旧函数
	}, [absPath, releaseAll, onPageCount])

	// ── 缩放变化：尺寸失效，清空重来 ──
	useEffect(() => {
		const d = doc
		if (d === null) return

		let cancelled = false

		releaseAll()

		async function recalc(): Promise<void> {
			// d 来自闭包，异步期间 TS 会判定其可能为 null
			if (d === null) return

			const list: PageSize[] = []
			for (let i = 1; i <= d.numPages; i++) {
				if (cancelled || docRef.current !== d) return

				try {
					const page = await d.getPage(i)
					const vp = page.getViewport({ scale })
					list.push({
						w: Math.floor(vp.width),
						h: Math.floor(vp.height)
					})
					page.cleanup()
				} catch {
					list.push({ w: 0, h: 0 })
				}
			}

			if (cancelled || docRef.current !== d) return
			setSizes(list)
			onPageCount?.(list.length)
		}

		void recalc()

		return () => {
			cancelled = true
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [doc, scale])

	useEffect(() => {
		if (doc === null || sizes.length === 0) return

		renderVisible()

		const el = scrollRef.current
		if (el === null) return

		let raf = 0
		const onScroll = (): void => {
			if (raf !== 0) return
			raf = requestAnimationFrame(() => {
				raf = 0
				renderVisible()
			})
		}

		el.addEventListener("scroll", onScroll, { passive: true })

		return () => {
			el.removeEventListener("scroll", onScroll)
			if (raf !== 0) cancelAnimationFrame(raf)
		}
	}, [doc, sizes, renderVisible])

	useEffect(() => {
		return () => {
			releaseAll()
			wrappersRef.current = []
			docRef.current = null
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	return (
		<div className="flex flex-col h-full">
			<div className="flex items-center gap-2 px-4 py-2 border-b text-xs shrink-0">
				<span className="opacity-60">
					{sizes.length > 0 ? `${sizes.length} 页` : "加载中…"}
				</span>

				<div className="ml-auto flex items-center gap-1">
					{SCALES.map((s) => (
						<button
							key={s}
							className={`px-1.5 py-0.5 rounded ${
								s === scale
									? "bg-blue-100 text-blue-700"
									: "hover:bg-black/5"
							}`}
							onClick={() => setScale(s)}
						>
							{Math.round(s * 100)}%
						</button>
					))}
				</div>
			</div>

			<div ref={scrollRef} className="flex-1 overflow-y-auto relative">
				<div
					className="flex flex-col items-center"
					style={{ height: totalHeight }}
				>
					{sizes.map((s, idx) => {
						const pageNo = idx + 1
						return (
							<div
								// key 带 generation：切换文档时强制重建 DOM，
								// 避免 React 复用同 key 的 wrapper 而把旧 canvas 留在里面
								key={`${genRef.current}-${pageNo}`}
								data-page={pageNo}
								ref={(el) => {
									wrappersRef.current[pageNo] = el
								}}
								className="flex justify-center py-2"
								style={{
									width: s.w > 0 ? `${s.w}px` : "100%",
									minHeight: s.h > 0 ? `${s.h}px` : undefined
								}}
							/>
						)
					})}
				</div>

				{err !== "" && (
					<div className="absolute inset-0 p-4 text-xs text-red-600 break-all">
						{err}
					</div>
				)}
			</div>
		</div>
	)
}
