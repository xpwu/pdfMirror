import {ClassArray, JsonKey} from "ts-json"


export class Model {
	Name: string = ""
	Size: string = ""
}

export class Models {
	@JsonKey("models")
	Models: Model[] = new ClassArray(Model)
	@JsonKey("ollama")
	Ollama: string = ""
}

let models = new Models()

export function GetModels(): Models {
	return models
}

export function SetModels(m: Models) {
	models = m
}
