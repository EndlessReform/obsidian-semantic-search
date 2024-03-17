// import { generateUuid5 } from 'weaviate-ts-client';
import weaviate, { WeaviateClient, generateUuid5 } from "weaviate-ts-client";
import { Notice, TFile, parseYaml } from "obsidian";

import MyPlugin, { WeaviateFile } from "../main";
import WeaviateManager, { getWeaviateConf } from "./WeaviateManager";

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
		const cleanContent = this.getCleanDoc(content);
		const metadataContent = this.extractYAMLWithoutDashes(content);
		// const tags = this.getAllTags(content)
		// const metadata = this.extractYAMLWithoutDashes(content)

		return this.weaviateManager.queryText(
			`${metadataContent}\n${cleanContent}`,
			[],
			this.plugin.settings.limit,
			this.plugin.settings.distanceLimit,
			this.plugin.settings.autoCut
		);
	}

	async getSidePaneNoteList(file: TFile) {
		const content = await this.plugin.app.vault.cachedRead(file);
		const cleanContent = this.getCleanDoc(content);
		// const tags = this.getAllTags(content)
		// const metadata = this.extractYAMLWithoutDashes(content)

		return this.weaviateManager.queryText(
			cleanContent,
			[],
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

	async queryWithNoteId(
		filePath: string,
		limit: number,
		distanceLimit: number,
		autoCut: number
	) {
		await this.weaviateManager.queryByDocId(
			filePath,
			limit,
			distanceLimit,
			autoCut
		);
	}

	async initClass() {
		await this.weaviateManager.initClasses(this.plugin.settings);
	}

	async addNew(
		content: string,
		path: string,
		filename: string,
		mtime: number
	) {
		const cleanContent = this.getCleanDoc(content);
		await this.weaviateManager.addNew(cleanContent, path, filename, mtime);
	}

	/**
	 * Upserts file if local version ahead of Weaviate
	 */
	async onUpdateFile(
		content: string,
		path: string,
		filename: string,
		mtime: number
	) {
		const fileStat = await this.weaviateManager.statFile(path);
		const doesExist = fileStat.fileExists;
		const isUpdated =
			!fileStat.mtime ||
			mtime - this.rfc3339ToUnixTimestamp(fileStat.mtime) > 0;

		const cleanContent = this.getCleanDoc(content);
		const tags = this.getAllTags(content);
		const metadata = this.extractYAMLWithoutDashes(content);

		// const yamlContent = this.objectToArray(this.extractYAMLWithoutDashes(content))

		if (doesExist && isUpdated && fileStat.id) {
			// console.log("updating " + path)
			const newValue = {
				content: cleanContent,
				metadata: metadata,
				tags: tags,
				mtime: this.unixTimestampToRFC3339(mtime),
			};

			await this.weaviateManager.mergeDoc(fileStat.id, newValue);

			// console.log"update note: " + filename + " time:" + this.unixTimestampToRFC3339(mtime))
		} else if (!doesExist && isUpdated) {
			await this.addNew(content, path, filename, mtime);
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

	async countOnDatabase() {
		const docsCount = await this.weaviateManager.docsCountOnDatabase();
		return docsCount;
	}

	async onDeleteFile(path: string): Promise<void> {
		await this.weaviateManager.deleteFile(path);
	}

	async deleteAll() {
		await this.weaviateManager.deleteClass(this.weaviateClass);

		new Notice(
			"Delete successful. Rescanning files and adding to database"
		);

		await this.initClass().then(async () => {
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

		for (const f of files) {
			let retries = 0;
			while (retries < maxRetries) {
				try {
					const content = await this.plugin.app.vault.cachedRead(f);
					await this.addNew(
						content,
						f.path,
						f.basename,
						f.stat.mtime
					);
					n_files_added++;

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

	async readAllPaths(): Promise<WeaviateFile[]> {
		const paths = await this.weaviateManager.getAllPaths();
		return paths;
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

	extractYAMLWithoutDashes(markdownContent: string) {
		// Define a regular expression to match YAML front matter without the dashes
		const yamlFrontMatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;

		// Use the regular expression to extract YAML content
		const match = markdownContent.match(yamlFrontMatterRegex);

		// If a match is found, return the YAML content without dashes

		if (match && match[1]) {
			const yaml_string = match[1].trim();
			return yaml_string;
			// return parseYaml(yaml_string)
		} else {
			return "";
		}
	}

	getAllTags(inputString: string) {
		const yaml = parseYaml(this.extractYAMLWithoutDashes(inputString));
		const yamlTags: Array<string> =
			yaml && yaml["tags"] ? yaml["tags"] : [];

		const regex = /#(\w+)/g;

		const tags = inputString.match(regex);
		const cleanTags = tags ? tags.map((match) => match.slice(1)) : [];

		if (tags || yamlTags) {
			return yamlTags.concat(cleanTags);
		} else {
			return [];
		}
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
