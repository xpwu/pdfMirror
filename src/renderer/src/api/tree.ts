import { ClassArray, Json } from "ts-json"

import { SetTree, Tree as DBTree } from "@/db/tree"

import { TreeNode } from "../../../shared/types"


// WorkspaceTree 拉取某个工作区的目录/文件树并写入内存 db。
//
// IPC 返回的是结构化克隆后的普通对象，需要经 ts-json 还原成
// 带原型的 class 实例，否则 class 上的方法会丢失。
export async function WorkspaceTree(
	sourceRoot: string
): Promise<Error | null> {
	const [ret, err] = await window.api.WorkspaceTree(sourceRoot)
	if (err !== null) {
		return new Error(err)
	}

	const [m, err2] = new Json().fromJson(
		JSON.stringify({ SourceRoot: sourceRoot, Nodes: ret }),
		DBTree
	)
	if (err2 !== null) {
		return err2
	}

	// 逐层补齐嵌套 Children 的类型。
	//
	// TreeNode.Children 是 TreeNode[]，ts-json 的顶层标注无法自动
	// 递归到嵌套层级，这里显式转换一次，确保目录展开后能拿到子节点。
	m.Nodes = normalize(m.Nodes)

	SetTree(m)

	return null
}


// normalize 把树中每个节点（含嵌套）转成 TreeNode 实例。
function normalize(nodes: TreeNode[] | null | undefined): TreeNode[] {
	const out = new ClassArray(TreeNode) as TreeNode[]

	for (const n of nodes ?? []) {
		if (n instanceof TreeNode) {
			n.Children = normalize(n.Children)
			out.push(n)
			continue
		}

		const t = new TreeNode()
		t.Name = n?.Name ?? ""
		t.Rel = n?.Rel ?? ""
		t.IsDir = n?.IsDir === true
		t.HasTranslated = n?.HasTranslated === true
		t.Children = normalize(n?.Children)
		out.push(t)
	}

	return out
}
