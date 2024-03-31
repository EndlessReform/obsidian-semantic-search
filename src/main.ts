import {
	CachedMetadata,
	MarkdownView,
	Notice,
	PaneType,
	Plugin,
	TFile,
} from "obsidian";
import { SIDE_PANE_VIEW_TYPE, SidePane } from "./SidePane";
import { GetOnNoteViewExtension } from "./OnNoteViewExtension";
import { GetSearchCodeBlock } from "./SearchCodeBlock";
import { MySettings } from "./SettingTab";
import VectorServer from "./VectorServer";
import { SearchNoteModal, createStatusBarIcon, StatusBarModal } from "./ui";

const DEFAULT_SETTINGS: Partial<AINoteSuggestionSettings> = {
	weaviateAddress: "http://localhost:3636",
	weaviateClass: "ObsidianVectors",
	openAIBaseUrl: "https://api.openai.com/v1/",
	embeddingModelName: "text-embedding-3-small",
	limit: 30,
	inDocMatchNotes: true,
	showPercentageOnCodeQuery: false,
	autoCut: 0,
	distanceLimit: 0,
	cacheSearch: false,
	showContent: true,
};

export interface AINoteSuggestionSettings {
	weaviateAddress: string;
	weaviateClass: string;
	/**
	 * Optional API base for OpenAI-compatible embedding server.
	 * Defaults to OpenAI itself
	 */
	openAIBaseUrl?: string;
	openAISecretKey?: string;
	embeddingModelName?: string;
	limit: number;
	inDocMatchNotes: boolean;
	showPercentageOnCodeQuery: boolean;
	autoCut: number;
	distanceLimit: number;
	cacheSearch: boolean;
	showContent: boolean;
}

export interface WeaviateFile {
	content: string;
	metadata: string;
	tags: string[];
	path: string;
	filename: string;
	mtime: string;
	_additional: {
		id: string;
		distance: number;
	};
}

export const CODE_HOVER_ID = "AI_CODE_HOVER_ID";
export const SIDE_PANE_HOVER_ID = "AI_SIDE_PANE_HOVER_ID";

export default class AINoteSuggestionPlugin extends Plugin {
	statusBarItemEl: HTMLElement;
	settings: AINoteSuggestionSettings;
	vectorServer: VectorServer;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new MySettings(this.app, this));
		this.vectorServer = new VectorServer(this.settings.weaviateClass, this);

		// show on hover settings
		this.registerHoverLinkSource(SIDE_PANE_HOVER_ID, {
			display: "AI Note suggestions",
			defaultMod: true,
		});
		this.registerHoverLinkSource(CODE_HOVER_ID, {
			display: "AI Note suggestions (Code block)",
			defaultMod: true,
		});

		this.registerEvents();
		this.registerCommands();
		// this.registerEditorExtension(GetOnNoteViewExtension(this));

		// UI
		this.addRibbonIcon("file-search", "Semantic search", () =>
			new SearchNoteModal(this).open()
		);
		this.statusBarItemEl = this.addStatusBarItem();
		createStatusBarIcon(this.statusBarItemEl, this.app);

		// Sidepane
		this.registerView(
			SIDE_PANE_VIEW_TYPE,
			(leaf) => new SidePane(leaf, this)
		);
		this.registerMarkdownCodeBlockProcessor(
			"match",
			GetSearchCodeBlock(this)
		);

		// TODO Re-enable
		// this.scanVault();
	}

	async onCreate(file: TFile) {
		if (file instanceof TFile) {
			const fileContent = await this.app.vault.cachedRead(file);
			if (fileContent) {
				const metadata = this.app.metadataCache.getFileCache(file);
				this.vectorServer.onUpdateFile(
					fileContent,
					metadata,
					file.path,
					file.basename,
					file.stat.mtime
				);
			}
		}
	}

	async onModify(file: TFile, metadata?: CachedMetadata | null) {
		if (file instanceof TFile) {
			const fileContent = await this.app.vault.cachedRead(file);
			if (fileContent) {
				if (typeof metadata === "undefined") {
					metadata = this.app.metadataCache.getFileCache(file);
				}
				this.vectorServer.onUpdateFile(
					fileContent,
					metadata || null,
					file.path,
					file.basename,
					file.stat.mtime
				);
			} else {
				this.vectorServer.onDeleteFile(file.path);
			}
		}
	}

	async onRename(file: TFile, oldPath: string) {
		if (file instanceof TFile) {
			// console.log("old path", oldPath)
			// console.log("new path", file.path)
			this.vectorServer.onRename(
				file.path,
				file.basename,
				file.stat.mtime,
				oldPath
			);
		}
	}

	async onDelete(file: TFile) {
		// console.log"delete path", file)
		this.vectorServer.onDeleteFile(file.path);
	}

	// initial scan ran on load and on setting changed
	async scanVault() {
		await this.vectorServer.initDBClass();
		const localFiles = this.app.vault.getMarkdownFiles();
		// console.log"file scan size", files.length)
		const pathsOnServer = await this.vectorServer.readAllPaths();

		const serverFileMap: Record<string, number> = pathsOnServer.reduce(
			(acc, f) => ({ ...acc, [f.path]: f.mtime }),
			{}
		);
		const clientAheadFiles: TFile[] = localFiles.filter(
			(f) =>
				f.path in serverFileMap && f.stat.mtime > serverFileMap[f.path]
		);

		const maxFailures = 3; // Maximum number of allowed failures
		let failureCount = 0;

		// Update files where server is behind (if any)
		for (const file of clientAheadFiles) {
			try {
				const content = await this.app.vault.cachedRead(file);
				if (content) {
					const metadata = this.app.metadataCache.getFileCache(file);
					await this.vectorServer.onUpdateFile(
						content,
						metadata,
						file.path,
						file.basename,
						file.stat.mtime
					);
				}
			} catch (error) {
				failureCount++;
				console.error(`Error updating file: ${file.path}`, error);
				if (failureCount > maxFailures) {
					console.error(
						"Too many file update failures. Aborting the process."
					);
					new Notice(
						"Could not sync with Weaviate: too many update failures"
					);
					return;
				}
			}
		}

		if (pathsOnServer.length != localFiles.length) {
			const { newFiles, deletedPaths } = this.findExtraFiles(
				pathsOnServer.map((p) => p.path),
				localFiles
			);
			deletedPaths.map(async (path) => {
				await this.vectorServer.onDeleteFile(path);
			});
			newFiles.map(async (f) => {
				await this.onCreate(f);
			});
		}
	}

	findExtraFiles(
		weaviatePaths: string[],
		localFiles: TFile[]
	): { newFiles: TFile[]; deletedPaths: string[] } {
		const localFileSet = new Set(localFiles.map((f) => f.path));
		const serverFileSet = new Set(weaviatePaths);
		const extraFiles = weaviatePaths.filter(
			(weaviateFile) => !localFileSet.has(weaviateFile)
		);
		const newFiles = localFiles.filter(
			(localFile) => !serverFileSet.has(localFile.path)
		);
		return {
			newFiles,
			deletedPaths: extraFiles,
		};
	}

	registerEvents() {
		// console.log("register events")
		this.app.workspace.onLayoutReady(() =>
			// Avoid spurious "creation" requests
			this.registerEvent(
				this.app.vault.on("create", (file) => {
					if (file instanceof TFile) this.onCreate(file);
				})
			)
		);

		this.registerEvent(
			// Wait for metadata cache to finish indexing
			this.app.metadataCache.on("changed", (file, _, cache) => {
				if (file instanceof TFile) this.onModify(file, cache);
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) this.onRename(file, oldPath);
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile) this.onDelete(file);
			})
		);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	getCurrentOpenedFile() {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile instanceof TFile) {
			return activeFile;
		} else {
			return null;
		}
	}

	focusFile(filePath: string, paneType: PaneType | null, line?: number) {
		const targetFile = this.app.vault.getAbstractFileByPath(filePath);
		if (!targetFile) return;

		if (targetFile instanceof TFile) {
			if (paneType) {
				const otherLeaf = this.app.workspace.getLeaf(paneType);
				otherLeaf?.openFile(targetFile, { active: true });
			} else {
				const currentLeaf = this.app.workspace.getMostRecentLeaf();
				currentLeaf?.openFile(targetFile, {
					active: true,
					eState: line
						? {
								line,
						  }
						: undefined,
				});
			}
		}
	}

	registerCommands() {
		this.addCommand({
			id: "open-note-suggestion",
			name: "Side pane",
			callback: () => {
				this.activeView();
			},
		});

		this.addCommand({
			id: "open-search-note-suggestion",
			name: "Search Related notes",
			callback: () => {
				new SearchNoteModal(this).open();
			},
		});
	}

	async activeView() {
		this.app.workspace.detachLeavesOfType(SIDE_PANE_VIEW_TYPE);

		await this.app.workspace.getRightLeaf(false)?.setViewState({
			type: SIDE_PANE_VIEW_TYPE,
			active: true,
		});

		this.app.workspace.revealLeaf(
			this.app.workspace.getLeavesOfType(SIDE_PANE_VIEW_TYPE)[0]
		);
	}

	async onunload() {
		// console.log("on onload plugin")
	}
}
