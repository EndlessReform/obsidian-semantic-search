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

	const sectionHeadings = metadataCache.sections.filter(
		(s) => s.type === "heading"
	);
	let headings = metadataCache.headings;
	if (
		sectionHeadings.length > 0 &&
		(!metadataCache.headings ||
			metadataCache.headings?.length !== sectionHeadings.length)
	) {
		// Obsidian headingCache is hit with weird concurrency bug. This has been happening for years.
		// Let's just build it ourselves.
		let newHeadingCache: HeadingCache[] = [];
		for (let heading of sectionHeadings) {
			const rawHeading = content.slice(
				heading.position.start.offset,
				heading.position.end.offset
			);

			const isHashes = (s: string) => s.match(/^#*$/);

			const parts = rawHeading.split(" ");
			if (
				(parts[0] !== "" && isHashes(parts[0])) ||
				(parts[0] === "" && parts.length >= 2 && isHashes(parts[1]))
			) {
				newHeadingCache.push({
					heading: parts[1],
					level: parts[0].length,
					position: heading.position,
				});
			} else {
				console.error(parts);
				throw new Error(`Invalid heading: ${rawHeading}`);
			}
		}
		headings = newHeadingCache;
	}

	const tree = buildDocTree(metadataCache?.sections, headings || []);
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
