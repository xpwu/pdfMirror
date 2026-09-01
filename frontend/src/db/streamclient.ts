import {Client, withBrowser} from "ts-streamclient"

let client: Client = new Client(withBrowser("xxxx"))

export function StreamClient(): Client {
	return client
}