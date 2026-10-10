/** Display-only projection of an existing authoring session or selection. */
export interface AuthoringTaskPresentation {
	readonly id: string;
	readonly kind: "rail" | "structure" | "blueprint" | "equipment" | "selection";
	readonly title: string;
	readonly instruction?: string;
	readonly status?: {
		readonly tone: "neutral" | "ready" | "blocked";
		readonly message: string;
	};
}
