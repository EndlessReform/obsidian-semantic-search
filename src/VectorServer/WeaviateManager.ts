import weaviate, { ConnectionParams, WeaviateClient } from "weaviate-ts-client";

export function getWeaviateConf(weaviateAddress: string): ConnectionParams {
	const scheme = weaviateAddress.startsWith("http://") ? "http" : "https";
	const host = weaviateAddress.slice(scheme == "http" ? 7 : 8);

	return { host, scheme };
}

export default class WeaviateManager {
	private docsClassName: string;
	private client: WeaviateClient;

	constructor(weaviateConf: ConnectionParams, docsClassName: string) {
		this.docsClassName = docsClassName;
		this.client = weaviate.client(weaviateConf);
	}
}
