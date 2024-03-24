import MyPlugin from "./main";
import { App, Notice, PluginSettingTab, Setting } from "obsidian";

export class MySettings extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		const infoContainer = new Setting(containerEl)
			.setName("Server info (ignore empty files)")
			.setDesc("Loading info...");

		this.plugin.vectorServer
			.fileCountOnDatabase()
			.then((count) => {
				const localFileCount =
					this.plugin.app.vault.getMarkdownFiles().length;
				infoContainer.setDesc(
					`Total file synced ${count}/${localFileCount}`
				);
			})
			.catch((error) => {
				infoContainer.setDesc("Error loading info " + error);
			});

		// Database-specific settings
		this.containerEl.createEl("h3", {
			text: "Weaviate connection settings",
		});

		new Setting(containerEl)
			.setName("Weaviate address")
			.setDesc(
				"Enter the address for your Weaviate instance. If you're running the docker-compose on your machine, it's at localhost:3636."
			)
			.addText((text) =>
				text
					.setPlaceholder("Default: http://localhost:3636")
					.setValue(this.plugin.settings.weaviateAddress)
					.onChange(async (value) => {
						this.plugin.settings.weaviateAddress = value;
						await this.plugin.saveSettings();
						this.plugin.scanVault();
					})
			);

		new Setting(containerEl)
			.setName("Class")
			.setDesc(
				"Weaviate class name (Keep the first letter capital. Ex: Obsidian not obsidian "
			)
			.addText((text) =>
				text
					.setPlaceholder("ex: Obsidian")
					.setValue(this.plugin.settings.weaviateClass)
					.onChange(async (value) => {
						if (value) {
							// make the first letter capital
							const class_name =
								value[0].toUpperCase() + value.substring(1);
							text.setValue(class_name);

							this.plugin.settings.weaviateClass = class_name;
							await this.plugin.saveSettings();
							this.plugin.scanVault();
						}
					})
			);

		containerEl.createEl("h3", {
			text: "Embeddings settings",
		});

		new Setting(containerEl)
			.setName("API Endpoint")
			.setDesc(
				"MUST trigger rebuild to apply! URL for OpenAI-compatible embeddings server. Tested with OpenAI, HuggingFace `text-embedding-inference`"
			)
			.addText((t) =>
				t
					.setPlaceholder("ex. https://api.openai.com/v1")
					.setValue(`${this.plugin.settings.openAIBaseUrl}`)
					.onChange(async (value) => {
						// TODO: Validation
						this.plugin.settings.openAIBaseUrl = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("API Key")
			.setDesc(
				"Secret for embedding API. Can be left blank if your embedding service doesn't need a key. If you're using OpenAI, get this from https://platform.openai.com/api-keys"
			)
			.addText((t) =>
				t
					.setPlaceholder("ex. sk-...****")
					.setValue(`${this.plugin.settings.openAISecretKey || ""}`)
					.onChange(async (value) => {
						// TODO: validation
						this.plugin.settings.openAISecretKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Model name")
			.setDesc(
				"MUST trigger rebuild to apply! Name of the embedding model you're using. Defaults to OpenAI's text-embedding-3-small"
			)
			.addText((t) =>
				t
					.setPlaceholder("ex. text-embedding-3-small")
					.setValue(
						`${this.plugin.settings.embeddingModelName || ""}`
					)
					.onChange(async (value) => {
						// TODO: validation
						this.plugin.settings.embeddingModelName = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", {
			text: "Search settings",
		});

		new Setting(containerEl)
			.setName("Suggestion Limit")
			.setDesc("Limit for how much result you want to see (max 30)")
			.addText((t) =>
				t
					.setPlaceholder("ex: 30")
					.setValue(`${this.plugin.settings.limit}`)
					.onChange(async (value) => {
						if (parseInt(value) > 30) {
							t.setValue("30");
						} else if (parseInt(value) <= 0) {
							t.setValue("1");
						}
						this.plugin.settings.limit = parseInt(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Similarity Distance")
			.setDesc(
				"Modify this if you want to set a similarity threshold, 2 is the lowest value (0 to disable). for more information check here \
     https://weaviate.io/developers/weaviate/search/similarity#distance-threshold"
			)
			.addText((t) =>
				t
					.setPlaceholder("ex: 70 ")
					.setValue(`${this.plugin.settings.distanceLimit}`)
					.onChange(async (value) => {
						let newval = parseFloat(value);
						if (parseFloat(value) > 2) {
							t.setValue("2");
							newval = 2;
						} else if (parseFloat(value) < 0) {
							t.setValue("0");
							newval = 0;
						}
						this.plugin.settings.distanceLimit = newval;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Enable Autocut")
			.setDesc(
				"Leave it 0 to disable if you don't know what is it. For info check here https://weaviate.io/developers/weaviate/search/similarity#autocut "
			)
			.addText((t) =>
				t
					.setPlaceholder("ex: 1 ")
					.setValue(`${this.plugin.settings.autoCut}`)
					.onChange(async (value) => {
						if (parseInt(value) < 0) {
							t.setValue("0");
						}
						this.plugin.settings.autoCut = parseInt(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Cached search")
			.setDesc("Cached search result for faster showing files")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.cacheSearch)
					.onChange(async (v) => {
						this.plugin.settings.cacheSearch = v;
						await this.plugin.saveSettings();
					})
			);

		// new Setting(containerEl)
		//     .setName('Show Percentage on query')
		//     .setDesc('Enable this if you want to get the match percentage info in code query')
		//     .addToggle(
		//         t => t
		//             .setValue(this.plugin.settings.showPercentageOnCodeQuery)
		//             .onChange(async v => {
		//                 this.plugin.settings.showPercentageOnCodeQuery = v;
		//                 await this.plugin.saveSettings();
		//             }))

		containerEl.createEl("h3", {
			text: "Related notes settings",
		});

		new Setting(containerEl)
			.setName("Show similar notes on top")
			.setDesc("Show related notes on top of the current note")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.inDocMatchNotes)
					.onChange(async (v) => {
						this.plugin.settings.inDocMatchNotes = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show snippet of notes in side pane view")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.showContent)
					.onChange(async (v) => {
						this.plugin.settings.showContent = v;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", {
			text: "Advanced settings",
		});

		new Setting(containerEl)
			.setName("Re-build vector store")
			.setDesc(
				"Remove all embeddings from Weaviate and rebuild. This only deletes files from the database: nothing will be deleted from Obsidian!"
			)
			.addButton((btn) =>
				btn.setButtonText("Delete all").onClick(async () => {
					new Notice("Deleting everything. Please wait");
					await this.plugin.vectorServer.deleteAll().catch((e) => {
						new Notice("Error Deleting, could not delete");
						// console.log(e)
					});
				})
			);
	}
}
