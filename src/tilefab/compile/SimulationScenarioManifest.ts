import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { isPositiveRecordId } from "../core/PortRecord";

export const SIMULATION_SCENARIO_MANIFEST_SCHEMA_VERSION = 1 as const;
export const SIMULATION_SCENARIO_TIME_UNIT = "MICROSECONDS" as const;
export const SIMULATION_SCENARIO_ORDERING_POLICY =
	"TIME_THEN_SOURCE_ORDINAL_THEN_RECORD_ID_V1" as const;
export const SIMULATION_SCENARIO_MAX_REJECTION_ISSUES = 128;
export const SIMULATION_SCENARIO_MAX_INPUT_RECORDS = 100_000;

export const SIMULATION_SCENARIO_SOURCE_KINDS = ["TRANSFER_PLAN", "REPLAY_HISTORY"] as const;
export type SimulationScenarioSourceKind = (typeof SIMULATION_SCENARIO_SOURCE_KINDS)[number];

const SIMULATION_SCENARIO_MANIFEST_KEYS = Object.freeze([
	"schemaVersion",
	"sourceKind",
	"timeUnit",
	"orderingPolicy",
	"manifestId",
	"adapterId",
	"adapterVersion",
	"mappingVersion",
	"inputRecordCount",
	"acceptedRecordCount",
	"rejectedRecordCount",
	"rejectionIssues",
	"issuesTruncated",
	"records",
	"fingerprint",
] as const);
const SIMULATION_SCENARIO_ISSUE_KEYS = Object.freeze(["sourceOrdinal", "code", "message"] as const);
const SIMULATION_TRANSFER_PLAN_RECORD_KEYS = Object.freeze([
	"sourceOrdinal",
	"transferId",
	"releaseTimeMicroseconds",
	"loadId",
	"sourcePortId",
	"destinationPortId",
] as const);
const SIMULATION_REPLAY_HISTORY_RECORD_KEYS = Object.freeze([
	"sourceOrdinal",
	"historyEventId",
	"observedTimeMicroseconds",
	"loadId",
	"sourcePortId",
	"destinationPortId",
] as const);

export interface SimulationScenarioRejectionIssue {
	readonly sourceOrdinal: number;
	readonly code: string;
	readonly message: string;
}

interface SimulationScenarioRecordBase {
	readonly sourceOrdinal: number;
	readonly loadId: string;
	readonly sourcePortId: number;
	readonly destinationPortId: number;
}

export interface SimulationTransferPlanRecord extends SimulationScenarioRecordBase {
	readonly transferId: string;
	readonly releaseTimeMicroseconds: number;
}

export interface SimulationReplayHistoryRecord extends SimulationScenarioRecordBase {
	readonly historyEventId: string;
	readonly observedTimeMicroseconds: number;
}

interface SimulationScenarioManifestInputBase {
	readonly manifestId: string;
	readonly adapterId: string;
	readonly adapterVersion: number;
	readonly mappingVersion: number;
	readonly inputRecordCount: number;
	readonly rejectedRecordCount: number;
	readonly rejectionIssues: readonly SimulationScenarioRejectionIssue[];
	readonly issuesTruncated: boolean;
}

export interface SimulationTransferPlanManifestInput extends SimulationScenarioManifestInputBase {
	readonly records: readonly SimulationTransferPlanRecord[];
}

export interface SimulationReplayHistoryManifestInput extends SimulationScenarioManifestInputBase {
	readonly records: readonly SimulationReplayHistoryRecord[];
}

interface SimulationScenarioManifestBase {
	readonly schemaVersion: typeof SIMULATION_SCENARIO_MANIFEST_SCHEMA_VERSION;
	readonly timeUnit: typeof SIMULATION_SCENARIO_TIME_UNIT;
	readonly orderingPolicy: typeof SIMULATION_SCENARIO_ORDERING_POLICY;
	readonly manifestId: string;
	readonly adapterId: string;
	readonly adapterVersion: number;
	readonly mappingVersion: number;
	readonly inputRecordCount: number;
	readonly acceptedRecordCount: number;
	readonly rejectedRecordCount: number;
	readonly rejectionIssues: readonly SimulationScenarioRejectionIssue[];
	readonly issuesTruncated: boolean;
	readonly fingerprint: string;
}

export interface SimulationTransferPlanManifest extends SimulationScenarioManifestBase {
	readonly sourceKind: "TRANSFER_PLAN";
	readonly records: readonly SimulationTransferPlanRecord[];
}

export interface SimulationReplayHistoryManifest extends SimulationScenarioManifestBase {
	readonly sourceKind: "REPLAY_HISTORY";
	readonly records: readonly SimulationReplayHistoryRecord[];
}

export type SimulationScenarioManifest =
	| SimulationTransferPlanManifest
	| SimulationReplayHistoryManifest;

export function compileSimulationTransferPlanManifest(
	input: SimulationTransferPlanManifestInput,
): SimulationTransferPlanManifest {
	return compileManifest("TRANSFER_PLAN", input);
}

export function compileSimulationReplayHistoryManifest(
	input: SimulationReplayHistoryManifestInput,
): SimulationReplayHistoryManifest {
	return compileManifest("REPLAY_HISTORY", input);
}

export function checksumSimulationScenarioManifest(
	manifest: Omit<SimulationScenarioManifest, "fingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		manifest.schemaVersion,
		manifest.adapterVersion,
		manifest.mappingVersion,
		manifest.inputRecordCount,
		manifest.acceptedRecordCount,
		manifest.rejectedRecordCount,
		manifest.issuesTruncated ? 1 : 0,
	]);
	checksum.addStrings([
		manifest.sourceKind,
		manifest.timeUnit,
		manifest.orderingPolicy,
		manifest.manifestId,
		manifest.adapterId,
	]);
	for (const issue of manifest.rejectionIssues) {
		checksum.addNumber(issue.sourceOrdinal);
		checksum.addStrings([issue.code, issue.message]);
	}
	for (const record of manifest.records) {
		checksum.addNumbers([
			record.sourceOrdinal,
			record.sourcePortId,
			record.destinationPortId,
			recordTime(manifest.sourceKind, record),
		]);
		checksum.addStrings([recordId(manifest.sourceKind, record), record.loadId]);
	}
	return checksum.digest();
}

export function simulationScenarioManifestError(value: unknown): string | null {
	if (!isRecord(value)) return "scenario manifest must be an object";
	if (!hasExactKeys(value, SIMULATION_SCENARIO_MANIFEST_KEYS)) {
		return "scenario manifest contains missing or unexpected fields";
	}
	if (
		!SIMULATION_SCENARIO_SOURCE_KINDS.includes(value.sourceKind as SimulationScenarioSourceKind)
	) {
		return "scenario source kind is invalid";
	}
	if (!Array.isArray(value.records) || !Array.isArray(value.rejectionIssues)) {
		return "scenario records or rejection issues are invalid";
	}
	const expectedRecordKeys =
		value.sourceKind === "TRANSFER_PLAN"
			? SIMULATION_TRANSFER_PLAN_RECORD_KEYS
			: SIMULATION_REPLAY_HISTORY_RECORD_KEYS;
	if (
		value.records.some(
			(record) => !isRecord(record) || !hasExactKeys(record, expectedRecordKeys),
		) ||
		value.rejectionIssues.some(
			(issue) => !isRecord(issue) || !hasExactKeys(issue, SIMULATION_SCENARIO_ISSUE_KEYS),
		)
	) {
		return "scenario records or rejection issues contain missing or unexpected fields";
	}
	try {
		const input = {
			manifestId: value.manifestId,
			adapterId: value.adapterId,
			adapterVersion: value.adapterVersion,
			mappingVersion: value.mappingVersion,
			inputRecordCount: value.inputRecordCount,
			rejectedRecordCount: value.rejectedRecordCount,
			rejectionIssues: value.rejectionIssues,
			issuesTruncated: value.issuesTruncated,
			records: value.records,
		} as unknown as SimulationTransferPlanManifestInput & SimulationReplayHistoryManifestInput;
		const canonical =
			value.sourceKind === "TRANSFER_PLAN"
				? compileSimulationTransferPlanManifest(input)
				: compileSimulationReplayHistoryManifest(input);
		if (
			value.schemaVersion !== canonical.schemaVersion ||
			value.timeUnit !== canonical.timeUnit ||
			value.orderingPolicy !== canonical.orderingPolicy ||
			value.acceptedRecordCount !== canonical.acceptedRecordCount ||
			value.fingerprint !== canonical.fingerprint
		) {
			return "scenario manifest identity is invalid";
		}
		if (!sameCanonicalRecordOrder(value.records, canonical.records, canonical.sourceKind)) {
			return "scenario records are not in canonical order";
		}
		if (!sameCanonicalIssueOrder(value.rejectionIssues, canonical.rejectionIssues)) {
			return "scenario rejection issues are not in canonical order";
		}
	} catch (error) {
		return error instanceof Error ? error.message : "scenario manifest is invalid";
	}
	return null;
}

export function serializeSimulationScenarioManifest(manifest: SimulationScenarioManifest): string {
	const error = simulationScenarioManifestError(manifest);
	if (error) throw new Error(`Simulation scenario manifest is invalid: ${error}`);
	return `${JSON.stringify(manifest)}\n`;
}

export function parseSimulationScenarioManifest(json: string): SimulationScenarioManifest {
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch {
		throw new Error("Simulation scenario manifest JSON is invalid.");
	}
	const error = simulationScenarioManifestError(value);
	if (error) throw new Error(`Simulation scenario manifest is invalid: ${error}`);
	const manifest = value as SimulationScenarioManifest;
	const input = {
		manifestId: manifest.manifestId,
		adapterId: manifest.adapterId,
		adapterVersion: manifest.adapterVersion,
		mappingVersion: manifest.mappingVersion,
		inputRecordCount: manifest.inputRecordCount,
		rejectedRecordCount: manifest.rejectedRecordCount,
		rejectionIssues: manifest.rejectionIssues,
		issuesTruncated: manifest.issuesTruncated,
		records: manifest.records,
	} as SimulationTransferPlanManifestInput & SimulationReplayHistoryManifestInput;
	return manifest.sourceKind === "TRANSFER_PLAN"
		? compileSimulationTransferPlanManifest(input)
		: compileSimulationReplayHistoryManifest(input);
}

function compileManifest(
	sourceKind: "TRANSFER_PLAN",
	input: SimulationTransferPlanManifestInput,
): SimulationTransferPlanManifest;
function compileManifest(
	sourceKind: "REPLAY_HISTORY",
	input: SimulationReplayHistoryManifestInput,
): SimulationReplayHistoryManifest;
function compileManifest(
	sourceKind: SimulationScenarioSourceKind,
	input: SimulationTransferPlanManifestInput | SimulationReplayHistoryManifestInput,
): SimulationScenarioManifest {
	assertManifestHeader(input);
	const records = input.records.map((record) => normalizeRecord(sourceKind, record));
	records.sort((left, right) => compareRecords(sourceKind, left, right));
	assertUniqueRecords(sourceKind, records);
	const rejectionIssues = normalizeRejectionIssues(input);
	const acceptedOrdinals = new Set(records.map((record) => record.sourceOrdinal));
	if (
		records.some((record) => record.sourceOrdinal >= input.inputRecordCount) ||
		rejectionIssues.some((issue) => acceptedOrdinals.has(issue.sourceOrdinal))
	) {
		throw new Error("Scenario accepted/rejected source ordinals are inconsistent.");
	}
	const manifestWithoutIdentity = {
		schemaVersion: SIMULATION_SCENARIO_MANIFEST_SCHEMA_VERSION,
		sourceKind,
		timeUnit: SIMULATION_SCENARIO_TIME_UNIT,
		orderingPolicy: SIMULATION_SCENARIO_ORDERING_POLICY,
		manifestId: input.manifestId,
		adapterId: input.adapterId,
		adapterVersion: input.adapterVersion,
		mappingVersion: input.mappingVersion,
		inputRecordCount: input.inputRecordCount,
		acceptedRecordCount: records.length,
		rejectedRecordCount: input.rejectedRecordCount,
		rejectionIssues,
		issuesTruncated: input.issuesTruncated,
		records: Object.freeze(records),
	} as Omit<SimulationScenarioManifest, "fingerprint">;
	return Object.freeze({
		...manifestWithoutIdentity,
		fingerprint: checksumSimulationScenarioManifest(manifestWithoutIdentity),
	}) as SimulationScenarioManifest;
}

function assertManifestHeader(
	input: SimulationTransferPlanManifestInput | SimulationReplayHistoryManifestInput,
): void {
	for (const [label, value] of [
		["manifest ID", input.manifestId],
		["adapter ID", input.adapterId],
	] as const) {
		if (!isPortableKey(value)) throw new Error(`Scenario ${label} is invalid.`);
	}
	for (const [label, value, positive] of [
		["adapter version", input.adapterVersion, true],
		["mapping version", input.mappingVersion, true],
		["input record count", input.inputRecordCount, false],
		["rejected record count", input.rejectedRecordCount, false],
	] as const) {
		if (!isSafeInteger(value, positive)) throw new Error(`Scenario ${label} is invalid.`);
	}
	if (input.inputRecordCount !== input.records.length + input.rejectedRecordCount) {
		throw new Error("Scenario input/accepted/rejected record counts do not reconcile.");
	}
	if (input.inputRecordCount > SIMULATION_SCENARIO_MAX_INPUT_RECORDS) {
		throw new Error("Scenario input record count exceeds the public run-asset limit.");
	}
}

function normalizeRecord(
	sourceKind: SimulationScenarioSourceKind,
	record: SimulationTransferPlanRecord | SimulationReplayHistoryRecord,
): SimulationTransferPlanRecord | SimulationReplayHistoryRecord {
	if (!isRecord(record)) throw new Error("Scenario record must be an object.");
	const id = recordId(sourceKind, record);
	const time = recordTime(sourceKind, record);
	if (!isPortableKey(id) || !isPortableKey(record.loadId)) {
		throw new Error("Scenario record or load identity is invalid.");
	}
	if (!isSafeInteger(record.sourceOrdinal, false) || !isSafeInteger(time, false)) {
		throw new Error(`Scenario record ${id} has an invalid ordinal or time.`);
	}
	if (
		!isPositiveRecordId(record.sourcePortId) ||
		!isPositiveRecordId(record.destinationPortId) ||
		record.sourcePortId === record.destinationPortId
	) {
		throw new Error(`Scenario record ${id} has invalid source/destination port IDs.`);
	}
	return sourceKind === "TRANSFER_PLAN"
		? Object.freeze({
				sourceOrdinal: record.sourceOrdinal,
				transferId: id,
				releaseTimeMicroseconds: time,
				loadId: record.loadId,
				sourcePortId: record.sourcePortId,
				destinationPortId: record.destinationPortId,
			})
		: Object.freeze({
				sourceOrdinal: record.sourceOrdinal,
				historyEventId: id,
				observedTimeMicroseconds: time,
				loadId: record.loadId,
				sourcePortId: record.sourcePortId,
				destinationPortId: record.destinationPortId,
			});
}

function normalizeRejectionIssues(
	input: SimulationTransferPlanManifestInput | SimulationReplayHistoryManifestInput,
): readonly SimulationScenarioRejectionIssue[] {
	const expectedIssueCount = Math.min(
		input.rejectedRecordCount,
		SIMULATION_SCENARIO_MAX_REJECTION_ISSUES,
	);
	if (input.rejectionIssues.length !== expectedIssueCount) {
		throw new Error("Scenario rejection issue count does not match the bounded review contract.");
	}
	if (input.issuesTruncated !== input.rejectedRecordCount > expectedIssueCount) {
		throw new Error("Scenario rejection issue truncation flag is invalid.");
	}
	const seenOrdinals = new Set<number>();
	const issues = input.rejectionIssues.map((issue) => {
		if (
			!isRecord(issue) ||
			!isSafeInteger(issue.sourceOrdinal, false) ||
			issue.sourceOrdinal >= input.inputRecordCount ||
			!isPortableCode(issue.code) ||
			!isDiagnosticMessage(issue.message) ||
			seenOrdinals.has(issue.sourceOrdinal)
		) {
			throw new Error("Scenario rejection issue is invalid or duplicated.");
		}
		seenOrdinals.add(issue.sourceOrdinal);
		return Object.freeze({
			sourceOrdinal: issue.sourceOrdinal,
			code: issue.code,
			message: issue.message,
		});
	});
	issues.sort(
		(left, right) =>
			left.sourceOrdinal - right.sourceOrdinal || comparePortableKeys(left.code, right.code),
	);
	return Object.freeze(issues);
}

function assertUniqueRecords(
	sourceKind: SimulationScenarioSourceKind,
	records: readonly (SimulationTransferPlanRecord | SimulationReplayHistoryRecord)[],
): void {
	const ids = new Set<string>();
	const ordinals = new Set<number>();
	for (const record of records) {
		const id = recordId(sourceKind, record);
		if (ids.has(id) || ordinals.has(record.sourceOrdinal)) {
			throw new Error("Scenario record identity or source ordinal is duplicated.");
		}
		ids.add(id);
		ordinals.add(record.sourceOrdinal);
	}
}

function compareRecords(
	sourceKind: SimulationScenarioSourceKind,
	left: SimulationTransferPlanRecord | SimulationReplayHistoryRecord,
	right: SimulationTransferPlanRecord | SimulationReplayHistoryRecord,
): number {
	return (
		recordTime(sourceKind, left) - recordTime(sourceKind, right) ||
		left.sourceOrdinal - right.sourceOrdinal ||
		comparePortableKeys(recordId(sourceKind, left), recordId(sourceKind, right))
	);
}

function comparePortableKeys(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sameCanonicalRecordOrder(
	actual: readonly unknown[],
	canonical: readonly (SimulationTransferPlanRecord | SimulationReplayHistoryRecord)[],
	sourceKind: SimulationScenarioSourceKind,
): boolean {
	if (actual.length !== canonical.length) return false;
	return actual.every((record, index) => {
		if (!isRecord(record)) return false;
		const expected = canonical[index] as
			| SimulationTransferPlanRecord
			| SimulationReplayHistoryRecord;
		return (
			recordId(sourceKind, record as never) === recordId(sourceKind, expected) &&
			recordTime(sourceKind, record as never) === recordTime(sourceKind, expected) &&
			record.sourceOrdinal === expected.sourceOrdinal &&
			record.loadId === expected.loadId &&
			record.sourcePortId === expected.sourcePortId &&
			record.destinationPortId === expected.destinationPortId
		);
	});
}

function sameCanonicalIssueOrder(
	actual: readonly unknown[],
	canonical: readonly SimulationScenarioRejectionIssue[],
): boolean {
	if (actual.length !== canonical.length) return false;
	return actual.every((issue, index) => {
		if (!isRecord(issue)) return false;
		const expected = canonical[index] as SimulationScenarioRejectionIssue;
		return (
			issue.sourceOrdinal === expected.sourceOrdinal &&
			issue.code === expected.code &&
			issue.message === expected.message
		);
	});
}

export function simulationScenarioRecordId(
	manifest: SimulationScenarioManifest,
	record: SimulationTransferPlanRecord | SimulationReplayHistoryRecord,
): string {
	return recordId(manifest.sourceKind, record);
}

export function simulationScenarioRecordTimeMicroseconds(
	manifest: SimulationScenarioManifest,
	record: SimulationTransferPlanRecord | SimulationReplayHistoryRecord,
): number {
	return recordTime(manifest.sourceKind, record);
}

function recordId(
	sourceKind: SimulationScenarioSourceKind,
	record: SimulationTransferPlanRecord | SimulationReplayHistoryRecord,
): string {
	return sourceKind === "TRANSFER_PLAN"
		? (record as SimulationTransferPlanRecord).transferId
		: (record as SimulationReplayHistoryRecord).historyEventId;
}

function recordTime(
	sourceKind: SimulationScenarioSourceKind,
	record: SimulationTransferPlanRecord | SimulationReplayHistoryRecord,
): number {
	return sourceKind === "TRANSFER_PLAN"
		? (record as SimulationTransferPlanRecord).releaseTimeMicroseconds
		: (record as SimulationReplayHistoryRecord).observedTimeMicroseconds;
}

function isSafeInteger(value: unknown, positive: boolean): value is number {
	return Number.isSafeInteger(value) && (positive ? (value as number) > 0 : (value as number) >= 0);
}

function isPortableKey(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 128 &&
		/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
	);
}

function isPortableCode(value: unknown): value is string {
	return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value);
}

function isDiagnosticMessage(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
	for (let index = 0; index < value.length; index++) {
		if (value.charCodeAt(index) < 32) return false;
	}
	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const keys = Object.keys(value);
	return keys.length === expected.length && expected.every((key) => keys.includes(key));
}
