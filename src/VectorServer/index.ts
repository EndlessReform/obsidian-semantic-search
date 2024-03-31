import { CachedMetadata, Notice, TFile, parseYaml } from "obsidian";

import MyPlugin, { WeaviateFile } from "../main";
import WeaviateManager, { getWeaviateConf } from "./WeaviateManager";
import { chunkDocument } from "../chunks";
import { globalStore } from "src/state";

interface LocalQuery {
	files: Array<{ files: Array<WeaviateFile>; filePath: string }>;
}

export default class VectorServer {
	private plugin: MyPlugin;
	private weaviateClass: string;
	private dbFileName: string;
	private weaviateManager: WeaviateManager;

	constructor(weaviateClass: string, plugin: MyPlugin) {
		this.weaviateClass = weaviateClass;
		this.plugin = plugin;
		this.dbFileName = ".obsidian/plugins/obsidian-semantic-search/db.json";
		this.weaviateManager = new WeaviateManager(
			getWeaviateConf(this.plugin.settings),
			this.plugin.settings.limit,
			this.weaviateClass
		);
	}

	async getSearchModalQueryNoteList(text: string) {
		return this.weaviateManager.queryText(
			text,
			[],
			this.plugin.settings.limit,
			this.plugin.settings.distanceLimit,
			this.plugin.settings.autoCut
		);
	}

	async getExtensionNoteList(file: TFile) {
		const content = await this.plugin.app.vault.cachedRead(file);
		// TODO: Remove this!
		const cleanContent = this.getCleanDoc(content);

		return this.weaviateManager.queryText(
			cleanContent,
			[],
			this.plugin.settings.limit,
			this.plugin.settings.distanceLimit,
			this.plugin.settings.autoCut
		);
	}

	async getSimilarNotes(file: TFile) {
		// TODO: Caching!
		//const content = await this.plugin.app.vault.cachedRead(file);
		//const cleanContent = this.getCleanDoc(content);
		const fileVector = await this.weaviateManager.getFileMeanEmbedding(
			file.path
		);

		return this.weaviateManager.queryVector(
			fileVector,
			this.plugin.settings.limit,
			this.plugin.settings.distanceLimit,
			this.plugin.settings.autoCut
		);
	}

	async getCodeBlockNoteList(
		content: string,
		tags: string[],
		limit: number,
		distanceLimit: number,
		autoCut: number
	) {
		return this.weaviateManager.queryText(
			content,
			tags,
			limit,
			distanceLimit,
			autoCut
		);
	}

	convertToSimilarPercentage(cosine: number) {
		const percentage = (50 * cosine - 100) * -1;
		return percentage.toFixed(2) + "%";
	}

	async initDBClass() {
		await this.weaviateManager.initClasses(this.plugin.settings);
	}

	async addNew(
		content: string,
		metadata: CachedMetadata | null,
		path: string,
		filename: string,
		mtime: number
	) {
		// May regret this
		await this.onUpdateFile(content, metadata, path, filename, mtime);
	}

	/**
	 * Upserts file if local version ahead of Weaviate
	 */
	async onUpdateFile(
		content: string,
		metadata: CachedMetadata | null,
		path: string,
		filename: string,
		mtime: number
	) {
		if (
			metadata === null ||
			typeof metadata?.sections === "undefined" ||
			content === ""
		) {
			// If file is empty, don't bother
			await this.onDeleteFile(path);
			return;
		} else {
			// By invariant, no headings in sections without a full headings array
			// console.log(metadata);
			const chunks = await chunkDocument(
				content,
				metadata,
				path,
				filename,
				this.unixTimestampToRFC3339(mtime)
			);
			const chunksHashSet = new Set(chunks.map((c) => c.hash));

			// Assume client is right.
			const weaviateChunks =
				await this.weaviateManager.getFileChunkHashes(path);
			const staleChunks = weaviateChunks.filter(
				(c) => !chunksHashSet.has(c.hash)
			);

			// Push new chunks; update remaining chunk position metadata
			await this.weaviateManager.batchUpsertChunks(chunks);
			// Delete stale chunks.
			// Note that this isn't technically atomic (Weaviate doesn't have transation (Weaviate doesn't have transations)s),
			// but batching IS atomic and took care of everything else, so it's good enough
			if (staleChunks.length > 0) {
				await this.weaviateManager.batchDeleteChunks(
					staleChunks.map((c) => c._additional.id)
				);
			}
		}
	}

	async onRename(
		path: string,
		filename: string,
		mtime: number,
		oldPath: string
	) {
		const fileStat = await this.weaviateManager.statFile(oldPath);
		if (fileStat.fileExists && fileStat.id) {
			await this.weaviateManager.mergeDoc(fileStat.id, {
				path: path,
				filename: filename,
				mtime: this.unixTimestampToRFC3339(mtime),
			});
		}
	}

	async onDeleteFile(path: string): Promise<void> {
		// Unfortunately there's no DELETE WHERE in Weaviate, so 2 round trips is the best we can do
		const chunks = await this.weaviateManager.getFileChunkHashes(path);
		if (chunks.length > 0) {
			await this.weaviateManager.batchDeleteChunks(
				chunks.map((c) => c._additional.id)
			);
		}
	}

	async deleteAll() {
		await this.weaviateManager.deleteClass(this.weaviateClass);
		globalStore.getState().clear_indexed();

		new Notice(
			"Delete successful. Rescanning files and adding to database"
		);

		await this.initDBClass().then(async () => {
			await this.initialSyncFiles();
		});
	}

	async initialSyncFiles() {
		const files = this.plugin.app.vault.getMarkdownFiles();
		let n_files_added = 0;
		let n_errors = 0;

		// Max retries per file
		const maxRetries = 2;

		console.info("Starting initial sync!");
		globalStore.getState().set_n_in_vault(files.length);

		for (const f of files) {
			let retries = 0;
			while (retries < maxRetries) {
				try {
					const content = await this.plugin.app.vault.cachedRead(f);
					const metadata =
						this.plugin.app.metadataCache.getFileCache(f);
					await this.onUpdateFile(
						content,
						metadata || null,
						f.path,
						f.basename,
						f.stat.mtime
					);
					n_files_added++;

					globalStore.getState().increment_indexed();
					// Sleep for a short duration to avoid making too many requests per second
					await new Promise((resolve) => setTimeout(resolve, 50)); // Adjust the delay as needed

					break;
				} catch (error) {
					retries++;
					if (retries < maxRetries) {
						console.error(
							`Error syncing file ${f.path}. Retrying (attempt ${retries} of ${maxRetries})`,
							error
						);
					} else {
						console.error(
							`Failed to sync file ${f.path} after ${maxRetries} retries.`,
							error
						);
						n_errors++;
					}
				}
			}

			// Bail out if there are more than 3 errors
			if (n_errors > 3) {
				console.error(
					"Too many errors encountered. Aborting the sync process."
				);
				new Notice(
					"Rebuild aborted due to multiple errors. Please check the console for more details."
				);
				return;
			}
		}

		if (n_files_added > 0) {
			new Notice(
				`Database rebuilt successfully! Total files added: ${n_files_added}`
			);
		}
	}

	async readAllPaths(): Promise<{ path: string; mtime: number }[]> {
		const paths = await this.weaviateManager.getAllPaths();
		return paths.map((p) => ({
			...p,
			mtime: this.rfc3339ToUnixTimestamp(p.mtime),
		}));
	}

	async fileCountOnDatabase() {
		const paths = await this.readAllPaths();
		return paths.length;
	}

	unixTimestampToRFC3339(unixTimestamp: number): string {
		const date = new Date(unixTimestamp);
		const isoString = date.toISOString();
		return isoString;
	}

	rfc3339ToUnixTimestamp(rfc3339: string): number {
		const date = new Date(rfc3339);
		return date.getTime();
	}

	// remove all markdown syntax
	getCleanDoc(markdownContent: string) {
		// Define a regular expression to match YAML front matter
		const yamlFrontMatterRegex = /^---\s*\n[\s\S]*?\n---\s*\n/;

		// Define a regular expression to match code blocks
		const codeBlockRegex = /```[^`]*```/g;

		// Remove YAML front matter
		const markdownWithoutYAML = markdownContent.replace(
			yamlFrontMatterRegex,
			""
		);

		// Remove code blocks
		const markdownWithoutCodeBlocks = markdownWithoutYAML.replace(
			codeBlockRegex,
			""
		);

		return markdownWithoutCodeBlocks;
	}

	async readCache() {
		let db: LocalQuery = { files: [] };

		if (await this.plugin.app.vault.adapter.exists(this.dbFileName)) {
			const data = await this.plugin.app.vault.adapter.read(
				this.dbFileName
			);
			db = JSON.parse(data);
			// console.log("cache db", db)
			return db.files;
		} else {
			db.files;
		}

		// const localFiles = db.files
		// const matchingFile = localFiles.filter(local => local.filePath === file.path)
		// return matchingFile
	}

	async writeCache(localQuery: LocalQuery) {
		await this.plugin.app.vault.adapter.write(
			this.dbFileName,
			JSON.stringify(localQuery)
		);
	}

	async addCachedNoteList(file: TFile, queryFiles: WeaviateFile[]) {
		const localFiles = await this.readCache();
		if (localFiles) {
			const removeFile = localFiles?.filter(
				(localFile) => file.path !== localFile.filePath
			);
			removeFile.push({ filePath: file.path, files: queryFiles });
			this.writeCache({ files: removeFile });
			return removeFile;
		} else {
			this.writeCache({ files: [] });
		}
	}

	async getCachedNoteList(file: TFile): Promise<WeaviateFile[]> {
		if (!this.plugin.settings.cacheSearch) return [];

		const localFiles = await this.readCache();
		if (localFiles) {
			const res = localFiles.filter(
				(localFile) => file.path === localFile.filePath
			);
			if (res.length > 0) {
				return res[0].files;
			} else return [];
		} else {
			return [];
		}
	}
}
