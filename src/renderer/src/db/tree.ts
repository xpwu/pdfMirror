import { ClassArray } from "ts-json"

import { TreeNode } from "../../../shared/types"


// 目录树的内存状态，附带它属于哪个工作区。
//
// 沿用 api / db 分层：db 只负责持有状态，不关心数据从哪来。
export class Tree {
	// 树的归属，避免切换工作区时短暂显示上一棵树的残留
	SourceRoot: string = ""

	// ClassArray 用于告知 ts-json 数组元素的类型。
	// 嵌套的 Children 同理需要标注，由 api 层补齐。
	Nodes: TreeNode[] = new ClassArray(TreeNode)
}


let tree = new Tree()

export function GetTree(): Tree {
	return tree
}

export function SetTree(t: Tree): void {
	tree = t
}
