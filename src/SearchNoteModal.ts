import { SuggestModal } from "obsidian";
import MyPlugin from "./main";
import { WeaviateChunk } from "./chunks";

export class SearchNoteModal extends SuggestModal<WeaviateChunk> {
	private myPlugin: MyPlugin;

	constructor(myPlugin: MyPlugin) {
		super(myPlugin.app);
		this.myPlugin = myPlugin;
	}

	// Returns all available suggestions.
	async getSuggestions(query: string): Promise<WeaviateChunk[]> {
		if (!query) return [];
		const similarFiles =
			await this.myPlugin.vectorServer.getSearchModalQueryNoteList(query);
		if (!similarFiles) return [];
		const fileFromDatabase: WeaviateChunk[] =
			similarFiles["data"]["Get"][this.myPlugin.settings.weaviateClass];
		return fileFromDatabase;
	}

	// Renders each suggestion item.
	renderSuggestion(note: WeaviateChunk, el: HTMLElement) {
		const file_similarity =
			this.myPlugin.vectorServer.convertToSimilarPercentage(
				note._additional.distance
			);
		el.createEl("div", { text: note.filename });
		el.createEl("small", { text: file_similarity });
		el.createEl("p", {
			text: note.content.split(" ").slice(0, 48).join(" "),
			cls: "searchresult__preview",
		});
	}

	// Perform action on the selected suggestion.
	onChooseSuggestion(note: WeaviateChunk, evt: MouseEvent | KeyboardEvent) {
		this.myPlugin.focusFile(note.path, null, note.start_line);
	}
}
