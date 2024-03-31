import { StatusBarModal } from "./StatusBarModal";
import { App, setIcon } from "obsidian";

export const createStatusBarIcon = (el: HTMLElement, app: App) => {
	setIcon(el, "scan-search");
	el.createEl("span", { cls: "statusbar__label" }).setText("Search");
	//el.setText("Search");
	el.onClickEvent(() => {
		new StatusBarModal(app).open();
	});
};
