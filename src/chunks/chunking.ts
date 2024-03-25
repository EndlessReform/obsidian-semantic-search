import { HeadingCache, SectionCache } from "obsidian";

class SectionNode {
	/** Corresponds to SectionCache type */
	type: string;
	/** 0: In document without heading above. Does NOT correspond to depth! */
	headingLevel: number;
	/** Absolute position of start in file */
	start: number;
	/**
	 * Absolute position of end of content in file.
	 * For heading / H0, NOT the end of children content!
	 */
	end: number;
	children: SectionNode[];

	constructor(
		type: string,
		headingLevel: number,
		start: number,
		end: number
	) {
		this.type = type;
		(this.headingLevel = headingLevel), (this.start = start);
		this.end = end;
		this.children = [];
	}

	/** Meant for use during in-order buildup from File */
	addLastChild(child: SectionNode) {
		this.children.push(child);
	}

	getDims(): { start: number; end: number } {
		if (this.children.length === 0) {
			// Leaf node
			return { start: this.start, end: this.end };
		} else {
			const lastChild = this.children[this.children.length - 1];
			return { start: this.start, end: lastChild.getDims().end };
		}
	}
}

export function buildDocTree(
	sections: SectionCache[],
	headings: HeadingCache[]
): SectionNode[] {
	const roots: SectionNode[] = [];

	// Strip out frontmatter since we're not embedding
	if (sections[0].type === "yaml") {
		sections = sections.slice(1);
	}

	// Handle common case where document does not start with heading
	if (sections[0].type !== "heading") {
		roots.push(
			new SectionNode(
				"h0",
				0,
				sections[0].position.start.offset,
				sections[0].position.end.offset
			)
		);
	}

	// Memoize last heading node in tree
	let parent: SectionNode = roots[0];

	for (const section of sections) {
		if (section.type === "heading") {
			const heading = headings.shift()!;
			const level = heading.level;

			const new_node = new SectionNode(
				section.type,
				level,
				section.position.start.offset,
				section.position.end.offset
			);

			let new_parent = roots[roots.length - 1];
			if (
				typeof new_parent === "undefined" ||
				level <= new_parent.headingLevel ||
				new_parent.headingLevel === 0
			) {
				// New heading is top-level
				roots.push(new_node);
			} else {
				// Start from top and go down tree to find parent (ex. h3 = h2 + 1).
				// Leads to O(n log d), but d <= 6 (it's Markdown) and most nodes aren't headings,
				// so I can't be bothered
				while (level > new_parent.headingLevel + 1) {
					new_parent =
						new_parent.children[new_parent.children.length - 1];
				}
				new_parent.addLastChild(new_node);
			}
			parent = new_node;
		} else {
			// Child of previous heading
			parent.addLastChild(
				new SectionNode(
					section.type,
					parent.headingLevel + 1,
					section.position.start.offset,
					section.position.end.offset
				)
			);
		}
	}

	return roots;
}

interface Chunk {
	start_offset: number;
	end_offset: number;
}

export function chunksFromSections(
	sectionNodes: SectionNode[],
	maxChunkChars: number
): Chunk[] {
	if (sectionNodes.length === 0) {
		return [];
	}

	let chunks: Chunk[] = [];
	let buffer: Chunk = {
		start_offset: sectionNodes[0].start,
		// By invariant now, buffer end_offset will be written at least once, so this is fine
		end_offset: Infinity,
	};

	let reversedSections = [...sectionNodes.reverse()];
	while (reversedSections.length > 0) {
		let section = reversedSections.pop()!;
		let dims = section.getDims();
		if (dims.end - dims.start > maxChunkChars) {
			if (section.children.length > 0) {
				// Section is too big but can be split: push children onto stack (in reverse order)
				reversedSections.push(...section.children.reverse());
				continue;
			} else {
				chunks.push(buffer);

				// Section is a really long content block.
				// We have no idea what's in here, so arbitrarily split it into roughly target_nchars sized chunks
				// A bit inelegant, but will work for now (plenty of fudge factor: 8192 embeddings, targeting ~1024!)
				let safe_length = Math.round(maxChunkChars * 0.9);
				let start = dims.start;
				while (start < dims.end) {
					let end = Math.min(start + safe_length, dims.end);

					if (end === dims.end && chunks.length > 0) {
						// If this is the last chunk and there are existing chunks,
						// append this chunk to the previous one and set buffer
						let lastChunk = chunks[chunks.length - 1];
						lastChunk.end_offset = end;
						buffer = {
							start_offset: end,
							end_offset: Infinity,
						};
					} else {
						chunks.push({
							start_offset: start,
							end_offset: end,
						});
					}

					start = end;
				}
			}
		} else {
			// Section can (in theory) fit into a single chunk. Try adding to buffer chunk
			if (dims.end - buffer.start_offset < maxChunkChars) {
				buffer.end_offset = dims.end;
			} else {
				chunks.push(buffer);
				buffer = {
					start_offset: buffer.end_offset,
					end_offset: dims.end,
				};
			}
		}
	}
	chunks.push(buffer);
	return chunks;
}
