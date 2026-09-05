import { ClassArray } from "ts-json"

import { PaperVersion } from "../../../shared/types"


// 当前论文的版本列表与译文内容。
//
// CurRel 记录这些版本属于哪篇论文，避免切换论文时
// 短暂显示上一篇的译文。
export class Paper {
	Rel: string = ""
	Versions: PaperVersion[] = new ClassArray(PaperVersion)
	CurModel: string = ""
	Content: string = ""
	// 译文文件的绝对路径，用于解析图片的相对路径
	MdAbsPath: string = ""
}


let paper = new Paper()

export function GetPaper(): Paper {
	return paper
}

export function SetPaper(p: Paper): void {
	paper = p
}
