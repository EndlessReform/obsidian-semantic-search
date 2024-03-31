import * as React from "react";
import { globalStore } from "src/state";
import { useStore } from "zustand";

export function ModalContent() {
	const n_indexed = useStore(globalStore, (state) => state.n_indexed);
	const n_in_vault = useStore(globalStore, (state) => state.n_in_vault);

	return (
		<div>
			<h1>Test</h1>
			<p>{n_in_vault}</p>
			<p>{n_indexed}</p>
		</div>
	);
}
