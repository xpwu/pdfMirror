import { useEffect, useRef, useState } from "react"

import { PaperVersion } from "../../../shared/types"


// VersionFloat 版本选择器。
//
// 悬浮在译文区右上角（§6.2）：不占流布局，滚动时保持可见。
export default function VersionFloat({
	versions,
	cur,
	onPick
}: {
	versions: PaperVersion[]
	cur: string
	onPick: (model: string) => void
}) {
	const [open, setOpen] = useState(false)
	const boxRef = useRef<HTMLDivElement>(null)

	// 点击外部关闭
	useEffect(() => {
		if (!open) return

		const onDown = (e: MouseEvent): void => {
			const t = e.target as Node | null
			if (t !== null && boxRef.current?.contains(t) === true) return
			setOpen(false)
		}

		document.addEventListener("mousedown", onDown)

		return () => document.removeEventListener("mousedown", onDown)
	}, [open])

	if (versions.length === 0) return null

	return (
		<div ref={boxRef} className="absolute top-3 right-3 z-20">
			<button
				className="rounded border bg-white/90 px-2 py-1 text-xs shadow backdrop-blur hover:bg-white"
				onClick={() => setOpen(!open)}
			>
				版本：{cur || "未选"} ▾
			</button>

			{open && (
				<ul className="absolute right-0 mt-1 min-w-[160px] rounded border bg-white shadow-lg py-1 text-xs">
					{versions.map((v) => (
						<li key={v.Model}>
							<button
								className={`w-full text-left px-3 py-1.5 hover:bg-black/5 ${
									v.Model === cur
										? "text-blue-700 font-medium"
										: ""
								}`}
								onClick={() => {
									onPick(v.Model)
									setOpen(false)
								}}
								title={v.FileName}
							>
								{v.Model}
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
