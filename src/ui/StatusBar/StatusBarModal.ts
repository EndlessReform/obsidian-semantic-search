import { App, Modal } from "obsidian";
import { createRoot } from "react-dom/client";
import { ModalContent } from "./ModalContent";
import * as React from "react";

export class StatusBarModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		let { contentEl } = this;
		contentEl.empty();

		const root = createRoot(contentEl);
		root.render(React.createElement(ModalContent));
	}

	onClose() {
		let { contentEl } = this;
		contentEl.empty();
	}
}
