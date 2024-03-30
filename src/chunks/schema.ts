import { WeaviateClass } from "weaviate-ts-client";

/**
 * Input schema for documents
 */
export interface Chunk {
	path: string;
	content: string;
	/** SHA-256 hash of (path + chunk content)  */
	hash: string;
	/** Start offset in file */
	start: number;
	/** End offset in file */
	end: number;
	start_line: number;
	metadata: string;
	tags: string[];
	filename: string;
	mtime: string;
}

/**
 * Weaviate document returned from Chunk schema, with vectors
 */
export interface WeaviateChunk extends Chunk {
	_additional: {
		id: string;
		distance: number;
	};
}

/**
 * Non-vectorized schema field
 */
function newMetadataField(
	name: string,
	dtype: string = "text",
	vectorizer: string = "text2vec-openai"
) {
	return {
		name,
		datatype: [dtype],
		moduleConfig: {
			[vectorizer]: {
				skip: "true",
			},
		},
	};
}

export function createOpenAIChunkClass(
	className: string,
	baseURL?: string,
	model?: string
): Partial<WeaviateClass> {
	// See https://weaviate.io/developers/weaviate/modules/retriever-vectorizer-modules/text2vec-openai
	const classDefinition = {
		class: className,
		description: "File chunks from Obsidian vault text files",
		properties: [
			{
				name: "path",
				datatype: ["text"],
				indexFilterable: true,
				moduleConfig: {
					["text2vec-openai"]: {
						skip: "true",
					},
				},
			},
			{
				name: "content",
				datatype: ["text"],
			},
			newMetadataField("hash"),
			newMetadataField("start", "number"),
			newMetadataField("end", "number"),
			newMetadataField("start_line", "number"),
			newMetadataField("metadata"),
			{
				name: "filename",
				datatype: ["text"],
				indexFilterable: true,
			},
			newMetadataField("tags", "text[]"),
			newMetadataField("mtime", "date"),
			//newMetadataField("type"),
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
