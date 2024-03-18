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

// TODO
function buildDocTree(
	sections: SectionCache[],
	headings: HeadingCache[]
): SectionNode[] {
	const roots: SectionNode[] = [];
	const lastInserted: number[] = [0];

	// TODO: Handle frontmatter!
	if (sections[0].type !== "heading") {
	} else if (sections[0].type !== "heading") {
		roots.push(new SectionNode("h0", 0, 0, 0));
	}

	for (const section of sections) {
		if (section.type === "heading") {
			const heading = headings.shift()!;
			const level = heading.level;

			let parent = roots[roots.length - 1];
			// TODO: Check this handles H0 correctly
			// Recurse down until find
			while (level <= parent.headingLevel && parent.headingLevel > 1) {
				parent = parent.children[parent.children.length - 1];
			}
		}
	}

	// TODO: Fix this
	return [];
}
