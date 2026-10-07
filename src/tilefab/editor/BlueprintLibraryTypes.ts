import type { RailAreaStampTemplate } from "../core/RailAreaStamp";
import type { RailModuleStampTemplate } from "../core/RailModuleStamp";
import type { StaticFabBlueprintTemplate } from "../core/StaticFabBlueprint";
import type { StaticFabOrganizationBundle } from "../core/StaticFabOrganizationBundle";
import type { OpenFabProjectBlueprint } from "../project/OpenFabBlueprintLibrary";
import type { OpenFabUserBlueprintRecord } from "../project/OpenFabUserBlueprintLibrary";

export type RailClipboard =
	| {
			readonly kind: "area";
			readonly template: RailAreaStampTemplate;
			readonly staticFabTemplate?: StaticFabBlueprintTemplate;
	  }
	| { readonly kind: "module"; readonly template: RailModuleStampTemplate }
	| {
			readonly kind: "organization";
			readonly bundle: StaticFabOrganizationBundle;
			readonly label: string;
	  };

export interface RailClipboardHistoryEntry {
	readonly id: number;
	readonly clipboard: RailClipboard;
}

export type BlueprintLibraryTab = "saved" | "user" | "recent";

export interface ProjectBlueprintNameDraft {
	readonly record: OpenFabProjectBlueprint;
	readonly projectGeneration: number;
	readonly name: string;
}

export interface UserBlueprintMetadataDraft {
	readonly id: string;
	readonly name: string;
	readonly folder: string;
}

export interface PendingUserBlueprintImport {
	readonly fileName: string;
	readonly record: OpenFabUserBlueprintRecord;
	readonly name: string;
	readonly folder: string;
}

export type ContextualBlueprintSaveRequest = "context" | "area" | "organization" | "whole-map";
