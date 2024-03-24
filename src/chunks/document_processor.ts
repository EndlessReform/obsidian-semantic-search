import * as crypto from "crypto";
import { CachedMetadata, HeadingCache, SectionCache } from "obsidian";
import { buildDocTree, chunksFromSections } from ".";

interface WeaviateChunk {
	/** SHA-256 hash of (path + chunk content)  */
	hash: string;
	/** Start offset in file */
	start: number;
	/** End offset in file */
	end: number;
	content: string;
	metadata: string;
	tags: string[];
	path: string;
	filename: string;
	mtime: string;
}

export async function hashChunk(
	chunkContent: string,
	path: string
): Promise<string> {
	const hash = crypto.createHash("sha256");
	hash.update(path);
	hash.update(chunkContent);
	return hash.digest("hex");
}

export async function chunkDocument(
	content: string,
	metadataCache: CachedMetadata,
	path: string,
	filename: string,
	mtime: string,
	maxChunkChars: number = 1024
): Promise<WeaviateChunk[]> {
	if (typeof metadataCache.sections === "undefined") {
		throw new Error("Must have sections to chunk!");
	}
	const tree = buildDocTree(
		metadataCache?.sections,
		metadataCache.headings || []
	);
	const chunk_borders = chunksFromSections(tree, maxChunkChars);
	const frontmatterMetadata = JSON.stringify(metadataCache.frontmatter);
	let tags = metadataCache.tags?.map((t) => t.tag);

	let chunks: WeaviateChunk[] = [];
	for (let border of chunk_borders) {
		const chunk_content = content
			.slice(border.start_offset, border.end_offset)
			.trim();
		const hash = await hashChunk(chunk_content, path);

		chunks.push({
			hash,
			start: border.start_offset,
			end: border.end_offset,
			content: chunk_content,
			metadata: frontmatterMetadata,
			tags: tags || [],
			path,
			filename,
			mtime,
		});
	}
	return chunks;
}
