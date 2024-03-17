import weaviate, {
	ConnectionParams,
	WeaviateClient,
	WeaviateClass,
	generateUuid5,
} from "weaviate-ts-client";
import { AINoteSuggestionSettings } from "../main";

export function getWeaviateConf(
	settings: AINoteSuggestionSettings
): ConnectionParams {
	const scheme = settings.weaviateAddress.startsWith("http://")
		? "http"
		: "https";
	const host = settings.weaviateAddress.slice(scheme == "http" ? 7 : 8);

	return {
		host,
		scheme,
		headers: {
			"X-OpenAI-Api-Key": settings.openAISecretKey || "",
		},
	};
}

function createOpenAiClassDef(
	className: string,
	baseURL?: string,
	model?: string
): Partial<WeaviateClass> {
	// See https://weaviate.io/developers/weaviate/modules/retriever-vectorizer-modules/text2vec-openai
	const classDefinition = {
		class: className,
		description: "Documents for an Obsidian Vault",
		properties: [
			{
				name: "path",
				datatype: ["text"],
				moduleConfig: {
					"text2vec-openai": {
						skip: "true",
					},
				},
			},
			{
				name: "filename",
				datatype: ["text"],
			},
			{
				name: "mtime",
				datatype: ["date"],
				moduleConfig: {
					"text2vec-openai": {
						skip: "true",
					},
				},
			},
			{
				name: "type",
				datatype: ["text"],
				moduleConfig: {
					"text2vec-openai": {
						skip: "true",
					},
				},
			},
			{
				name: "metadata",
				datatype: ["text"],
				moduleConfig: {
					"text2vec-openai": {
						skip: "true",
					},
				},
			},
			{
				name: "tags",
				datatype: ["text[]"],
				moduleConfig: {
					"text2vec-openai": {
						skip: "true",
					},
				},
			},
			{
				name: "content",
				datatype: ["text"],
			},
		],
		vectorizer: "text2vec-openai",
		moduleConfig: {
			"text2vec-openai": {
				type: "text",
				model: model || "text-embedding-3-small",
				baseURL,
			},
		},
	};
	return classDefinition;
}

export default class WeaviateManager {
	private docsClassName: string;
	client: WeaviateClient;

	constructor(weaviateConf: ConnectionParams, docsClassName: string) {
		this.docsClassName = docsClassName;
		this.client = weaviate.client(weaviateConf);
	}

	/**
	 * Sets up classes on Weaviate.
	 *
	 * Currently only handles single docs class with OpenAI
	 */
	async initClasses(settings: AINoteSuggestionSettings): Promise<boolean> {
		const allServerClasses = await this.client.schema.getter().do();

		// TODO: More validation
		// Assume user manually triggers rebuild if vector settings change
		let classNameExists = allServerClasses.classes?.reduce(
			(acc, classObj) => acc || classObj?.class == this.docsClassName,
			false
		);
		if (!classNameExists) {
			try {
				await this.client.schema
					.classCreator()
					.withClass(
						createOpenAiClassDef(
							this.docsClassName,
							settings.openAIBaseUrl,
							settings.embeddingModelName
						)
					)
					.do();
				console.debug(
					`Created ${this.docsClassName} on Weaviate for first time`
				);
				return true;
			} catch (e) {
				console.error(`Error creating class in Weaviate: ${e}`);
				return false;
			}
		} else {
			return true;
		}
	}

	/**
	 * Add new document to Weaviate
	 *
	 * @param content  Assume this was cleaned elsewhere
	 * @param path
	 * @param filename
	 * @param mtime
	 */
	async addNew(
		content: string,
		path: string,
		filename: string,
		mtime: number
	) {
		const properties = {
			filename,
			content,
			path,
			mtime: this.unixTimestampToRFC3339(mtime),
		};
		const note_id = generateUuid5(path);
		const addResponse = await this.client.data
			.creator()
			.withClassName(this.docsClassName)
			.withProperties(properties)
			.withId(note_id)
			.do();
		return addResponse;
	}

	/** Delete single document from Weaviate, identified by path */
	async deleteFile(path: string) {
		return this.client.data
			.deleter()
			.withClassName(this.docsClassName)
			.withId(generateUuid5(path))
			.do();
	}

	async docsCountOnDatabase() {
		const response = await this.client.graphql
			.aggregate()
			.withClassName(this.docsClassName)
			.withFields("meta { count }")
			.do();
		// console.log("count", response)
		const count =
			response.data["Aggregate"][this.docsClassName][0]["meta"]["count"];
		return count;
	}

	/** Converts to ISO format */
	unixTimestampToRFC3339(unixTimestamp: number): string {
		const date = new Date(unixTimestamp);
		const isoString = date.toISOString();
		return isoString;
	}
}
