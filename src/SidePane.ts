import { ItemView, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";
import MyPlugin, { SIDE_PANE_HOVER_ID, WeaviateFile } from "./main";
export const SIDE_PANE_VIEW_TYPE = "similar-notes";
import { WeaviateChunk } from "./chunks";

export class SidePane extends ItemView {
	listEl: HTMLElement;
	itemElement: HTMLElement;
	leaf: WorkspaceLeaf;
	myPlugin: MyPlugin;

	constructor(leaf: WorkspaceLeaf, myplugin: MyPlugin) {
		super(leaf);
		this.leaf = leaf;
		this.myPlugin = myplugin;

		const container = this.containerEl.children[1];
		this.listEl = container.createDiv();
		this.itemElement = container.createEl("div", { cls: "side_pane_list" });
	}

	async onOpen() {
		this.updateView();

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (f) => {
				const view =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				const isFile = view?.file?.path;

				if (isFile) {
					this.updateView();
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("create", () => {
				this.updateView();
			})
		);
		this.registerEvent(
			this.app.vault.on("modify", () => {
				this.updateView();
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", () => {
				this.updateView();
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", () => {
				this.updateView();
			})
		);
		// this.registerEvent(this.app.workspace.on('active-leaf-change',
		//     () => { this.updateView() }))
		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				this.updateView();
			})
		);
	}

	async updateView() {
		if (!this.listEl) return;
		const currentFile = this.myPlugin.getCurrentOpenedFile();

		if (!currentFile) return;
		this.listEl.empty();
		// set heading
		const heading = this.listEl.createEl("div", { cls: "side_pane" });
		heading.createEl("h5", {
			text: "Related notes for",
			cls: "side_pane_heading",
		});
		heading.createEl("p", {
			text: currentFile?.basename,
			cls: "side_pane_path",
		});

		// TODO: Fix cache
		// const cachedFiles = await this.myPlugin.vectorServer.getCachedNoteList(
		// 	currentFile
		// );
		// this.itemElement.empty();
		// cachedFiles.map((cacheFile) => {
		// 	this.populateItem(cacheFile);
		// });

		this.myPlugin.vectorServer
			.getSimilarNotes(currentFile)
			.then((similarFiles) => {
				if (!similarFiles) return;

				const fileFromDatabase: WeaviateChunk[] =
					similarFiles["data"]["Get"][
						this.myPlugin.settings.weaviateClass
					];
				const cleanFileList: WeaviateChunk[] = fileFromDatabase.filter(
					(item) => currentFile.path && currentFile.path != item.path
				);

				this.itemElement.empty();
				cleanFileList.map((file) => {
					this.populateItem(file);
				});
			});
	}

	populateItem(chunk: WeaviateChunk) {
		const file_name = chunk.filename;
		const file_similarity =
			this.myPlugin.vectorServer.convertToSimilarPercentage(
				chunk._additional.distance
			);
		// const opacity_val = parseFloat(file_similarity) * .01
		// itemElement.style.opacity = `${opacity_val}`

		const itemElement = this.itemElement.createEl("div", {
			cls: "side_pane_item",
		});

		itemElement.createEl("p", { text: file_name, cls: "file_name" });

		itemElement.createEl("p", {
			text: file_similarity,
			cls: "file_percent",
		});

		if (this.myPlugin.settings.showContent) {
			// Show chunk instead
			itemElement.createEl("p", {
				text: chunk.content.slice(0, 256),
				cls: "file_content",
			});
		}
		// click event
		itemElement.addEventListener("click", () => {
			this.myPlugin.focusFile(chunk.path, null, chunk.start_line);
		});

		itemElement.addEventListener("mouseenter", (event) => {
			this.myPlugin.app.workspace.trigger("hover-link", {
				source: SIDE_PANE_HOVER_ID,
				event: event,
				hoverParent: itemElement.parentElement,
				targetEl: itemElement,
				linktext: chunk.filename,
				sourcePath: chunk.path,
			});
		});
	}

	getViewType(): string {
		return SIDE_PANE_VIEW_TYPE;
	}
	async onClose() {
		// Nothing to clean up.
		// console.log"close side pane")
	}

	getDisplayText() {
		return "Suggestion";
	}

	getIcon(): string {
		return "search";
	}
}
