import { createStore } from "zustand/vanilla";

interface GlobalState {
	/**
	 * Number indexed ON THIS RUN. Subject to change
	 */
	n_indexed: number;
	/** Not guaranteed to be 100% in sync with repo file count... */
	n_in_vault: number;
	tokens_used: number;
}

interface GlobalStateAction {
	clear_indexed: () => void;
	increment_indexed: () => void;
	set_n_indexed: (n: number) => void;
	set_n_in_vault: (n: number) => void;
	add_tokens_used: (n: number) => void;
}

export const globalStore = createStore<GlobalState & GlobalStateAction>(
	(set) => ({
		n_indexed: 0,
		n_in_vault: 0,
		tokens_used: 0,
		clear_indexed: () => set(() => ({ n_indexed: 0 })),
		set_n_indexed: (n) => set(() => ({ n_indexed: n })),
		increment_indexed: () =>
			set((state) => ({ n_indexed: state.n_indexed + 1 })),
		set_n_in_vault: (n) => set(() => ({ n_in_vault: n })),
		add_tokens_used: (n) =>
			set((state) => ({ tokens_used: state.tokens_used + n })),
	})
);
