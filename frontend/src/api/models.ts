import {StreamClient} from "@/db/streamclient"
import {SetModels, Models as DBModels} from "@/db/models"
import {Json} from "ts-json"


export async function Models(): Promise<Error | null> {
	let [ret, err] = await StreamClient().Send("{}", {api: "models"})
	if (err !== null) {
		return err
	}

	let [m, err2] = new Json().fromJson(ret.toString(), DBModels)
	if (err2 !== null) {
		return err2
	}

	SetModels(m)

	return null
}
