import { useEffect, useState } from "react"

import { GC } from "@/api/app"
import { BitmapBytes, BitmapPages } from "@/lib/bitmapMem"


// MemoryBar 显示内存指标，用于判断切换论文后内存是否回落。
//
// 核心指标是「位图」，而非系统 RSS：
//   位图内存既不在 JS 堆里，也无法通过进程指标可靠拿到，
//   且 Chromium 释放后会把内存留在分配器池子里复用、不还给操作系统，
//   因此 RSS 天然下不来，用它判断泄漏是错的。
//
// 位图字节由 bitmapMem 自记账得到，精确反映「多少页的位图还活着」。
// 旁边同时显示页面上真实的 canvas 数量用于交叉验证 ——
// 两者应当一致，不一致说明记账与实际渲染脱节。
export default function MemoryBar() {
	const [dom, setDom] = useState(0)
	const [heap, setHeap] = useState(0)
	const [canvasCount, setCanvasCount] = useState(0)
	const [bmp, setBmp] = useState(0)
	const [pages, setPages] = useState(0)
	const [baseline, setBaseline] = useState(0)
	const [gcOK, setGcOK] = useState(true)

	useEffect(() => {
		function tick(): void {
			setDom(document.getElementsByTagName("*").length)
			setCanvasCount(document.querySelectorAll("canvas").length)
			setBmp(BitmapBytes())
			setPages(BitmapPages())

			const perf = performance as Performance & {
				memory?: { usedJSHeapSize: number }
			}
			if (perf.memory !== undefined) {
				setHeap(perf.memory.usedJSHeapSize)
			}
		}

		tick()
		const timer = setInterval(tick, 500)

		return () => clearInterval(timer)
	}, [])

	// 启动时探测一次 GC 是否可用
	useEffect(() => {
		setGcOK(GC())
	}, [])

	const mb = (v: number): string => (v / 1024 / 1024).toFixed(1)

	const over = baseline > 0 && bmp > baseline * 1.5
	const mismatch = canvasCount !== pages

	return (
		<div className="fixed bottom-0 left-0 right-0 z-50 flex items-center gap-3 bg-neutral-900 text-white text-[11px] px-3 py-1 font-mono">
			<span>DOM {dom}</span>
			<span className={mismatch ? "text-red-400" : ""}>
				canvas {canvasCount}
				{mismatch ? ` (记账 ${pages})` : ""}
			</span>
			<span className={over ? "text-red-400" : "text-emerald-400"}>
				位图 {mb(bmp)}MB / {pages} 页
			</span>
			<span>JS 堆 {mb(heap)}MB</span>

			{baseline > 0 && (
				<span className="text-neutral-400">
					基线 {mb(baseline)}MB{over ? " ↑ 超 50%" : ""}
				</span>
			)}

			<div className="ml-auto flex items-center gap-2">
				<button
					className="px-1.5 py-0.5 rounded bg-neutral-700 hover:bg-neutral-600"
					onClick={() => setBaseline(bmp)}
				>
					设为基线
				</button>

				<button
					className="px-1.5 py-0.5 rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40"
					onClick={() => setGcOK(GC())}
					disabled={!gcOK}
					title={gcOK ? "触发 V8 垃圾回收" : "未启用 --expose-gc"}
				>
					GC
				</button>
			</div>
		</div>
	)
}
