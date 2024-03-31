import * as React from "react";
import { globalStore } from "src/state";
import { useStore } from "zustand";
import { ScanSearch } from "lucide-react";

export function ModalContent() {
	const n_indexed = useStore(globalStore, (state) => state.n_indexed);
	const n_empty = useStore(globalStore, (state) => state.n_empty);
	const n_in_vault = useStore(globalStore, (state) => state.n_in_vault);

	return (
		<div>
			<div className="flex-center">
				<ScanSearch size={24} />
				<h2 style={{ marginLeft: "6px" }}>Sync status</h2>
			</div>
			<div className="flex-center">
				<p className="sync_modal__label">
					<span
						style={{
							fontWeight: "medium",
							color: "var(--text-normal)",
						}}
					>
						{n_indexed}
					</span>{" "}
					notes indexed {n_empty > 0 ? `(${n_empty} empty)` : ""}
				</p>
				<p className="sync_modal__label" style={{ marginLeft: "auto" }}>
					<span
						style={{
							fontWeight: "medium",
							color: "var(--text-normal)",
						}}
					>
						{n_in_vault}
					</span>{" "}
					in vault
				</p>
			</div>
			<div
				className="sync_modal__progress_bar"
				style={{
					backgroundColor: "var(--background-modifier-border)",
					overflow: "hidden",
				}}
			>
				<div
					className="sync_modal__progress_bar"
					style={{
						backgroundColor: "var(--background-modifier-success)",
						width: `${(n_indexed / n_in_vault) * 100}%`,
					}}
				></div>
			</div>
		</div>
	);
}
