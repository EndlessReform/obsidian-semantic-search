import weaviate, {
	ConnectionParams,
	WeaviateClient,
	WeaviateClass,
	generateUuid5,
} from "weaviate-ts-client";
import { AINoteSuggestionSettings, WeaviateFile } from "../main";
import { Chunk, createOpenAIChunkClass } from "src/chunks";

/**
 * Coupled to OpenAI for now
 */
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

export interface FileStat {
	fileExists: boolean;
	id?: string;
	/** RFC 3339 date */
	mtime?: string;
}

export default class WeaviateManager {
	private docsClassName: string;
	private limit: number;
	client: WeaviateClient;

	constructor(
		weaviateConf: ConnectionParams,
		limit: number,
		docsClassName: string
	) {
		this.docsClassName = docsClassName;
		this.client = weaviate.client(weaviateConf);
		this.limit = limit;
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
						createOpenAIChunkClass(
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

	/**
	 * Retrieve chunk metadata for path. Possibly empty if file doesn't exist.
	 */
	async getFileChunkHashes(path: string): Promise<
		{
			hash: string;
			start: number;
			end: number;
			_additional: { id: string };
		}[]
	> {
		const result = await this.client.graphql
			.get()
			.withClassName(this.docsClassName)
			.withWhere({
				path: ["path"],
				operator: "Equal",
				valueText: path,
			})
			.withFields(
				["hash", "start", "end"].join(" ") + " _additional { id }"
			)
			.do();

		if (result.data["Get"]) {
			return result.data["Get"][this.docsClassName];
		} else {
			return [];
		}
	}

	async statFile(path: string): Promise<FileStat> {
		const result = await this.client.graphql
			.get()
			.withClassName(this.docsClassName)
			.withWhere({
				path: ["path"],
				operator: "Equal",
				valueText: path,
			})
			.withFields(["filename", "mtime"].join(" ") + " _additional { id }")
			.do();

		const resultLength = result.data["Get"][this.docsClassName].length;
		if (resultLength > 0) {
			const id =
				result.data["Get"][this.docsClassName][0]["_additional"]["id"];
			const mtime = result.data["Get"][this.docsClassName][0]["mtime"];

			return {
				fileExists: true,
				id,
				mtime,
			};
		} else {
			return {
				fileExists: false,
				id: undefined,
				mtime: undefined,
			};
		}
	}

	/** Delete single document from Weaviate, identified by path */
	async deleteFile(path: string): Promise<void> {
		return this.client.data
			.deleter()
			.withClassName(this.docsClassName)
			.withId(generateUuid5(path))
			.do();
	}

	async deleteClass(className: string): Promise<void> {
		await this.client.schema.classDeleter().withClassName(className).do();
	}

	/** Merge doc with old name to new property set (and ID) */
	async mergeDoc(old_id: string, properties: any) {
		await this.client.data
			.merger()
			.withId(old_id)
			.withClassName(this.docsClassName)
			.withProperties(properties)
			.do();
	}

	/**
	 * https://github.com/weaviate/weaviate/issues/3949:
	 * Rely on Weaviate to optimize batch upsert for us
	 * (properties-only updates, upsert new)
	 */
	async batchUpsertChunks(chunks: Chunk[]) {
		let batcher = this.client.batch.objectsBatcher();
		for (const chunk of chunks) {
			batcher = batcher.withObject({
				class: this.docsClassName,
				properties: { ...chunk },
				// Path + content + position is unique
				id: generateUuid5(`${chunk.hash}${chunk.start}${chunk.end}`),
			});
		}
		await batcher.do();
	}

	async batchDeleteChunks(ids: string[]) {
		await this.client.batch
			.objectsBatchDeleter()
			.withClassName(this.docsClassName)
			.withWhere({
				path: ["id"],
				operator: "ContainsAny",
				valueTextArray: ids,
			})
			.do();
	}

	async docsCountOnDatabase() {
		const response = await this.client.graphql
			.aggregate()
			.withClassName(this.docsClassName)
			.withFields("meta { count }")
			.do();
		const count =
			response.data["Aggregate"][this.docsClassName][0]["meta"]["count"];
		return count;
	}

	async queryText(
		text: string,
		tags: string[],
		limit: number,
		distanceLimit: number,
		autoCut: number
	) {
		let nearText: { concepts: string[]; distance?: number } = {
			concepts: [text.trim()],
			distance: distanceLimit > 0 ? distanceLimit : undefined,
		};

		const result = this.client.graphql
			.get()
			.withClassName(this.docsClassName)
			.withNearText(nearText);

		if (tags && tags.length > 0) {
			result.withWhere({
				path: ["tags"],
				operator: "ContainsAny",
				valueTextArray: tags,
			});
		}
		if (autoCut > 0) {
			result.withAutocut(autoCut);
		}

		result
			.withLimit(limit)
			.withFields("filename path _additional { distance }");

		const response = await result.do();

		return response;
	}

	async getAllPaths(): Promise<string[]> {
		// Absurd hack because SELECT DISTINCT doesn't exist on Weaviate
		const group_query = await this.client.graphql
			.aggregate()
			.withClassName(this.docsClassName)
			.withGroupBy(["path"])
			.withFields("path { topOccurrences { value } }")
			.do();

		const paths: string[] = group_query.data["Aggregate"][
			this.docsClassName
		].map((r: any) => r["path"]["topOccurrences"][0]["value"]);
		return paths;
	}

	/** Converts to ISO format */
	unixTimestampToRFC3339(unixTimestamp: number): string {
		const date = new Date(unixTimestamp);
		const isoString = date.toISOString();
		return isoString;
	}
}
