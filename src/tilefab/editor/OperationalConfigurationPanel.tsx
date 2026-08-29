import {
	AlertTriangle,
	Check,
	CircleGauge,
	Database,
	Factory,
	Home,
	RotateCcw,
	Save,
	Search,
	ShieldCheck,
	Trash2,
	Truck,
	Warehouse,
	X,
} from "lucide-react";
import { type KeyboardEvent, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import type { EquipmentGroupRecord, PortEquipmentState } from "../core/EquipmentGroup";
import {
	copyOperationalConfigurationState,
	OPERATIONAL_RESIDENT_HOME_SLOT_LIMIT,
	OPERATIONAL_RESIDENT_HOME_SLOT_POLICY,
	OPERATIONAL_STATION_TRANSFER_CAPABILITIES,
	type OperationalConfigurationSourceIdentity,
	type OperationalConfigurationState,
	type OperationalLogicalDefinition,
	type OperationalStationTransferCapability,
	type OperationalStorageGroupConfigurationRecord,
	type OperationalStoragePolicyDefinition,
	type OperationalVehicleReservationProfile,
} from "../core/OperationalConfiguration";
import type { PortRecord, PortType } from "../core/PortRecord";
import {
	addOperationalEqCapability,
	addOperationalResidentHomeSlot,
	addOperationalStorageClass,
	addOperationalStoragePolicy,
	OPERATIONAL_CONFIGURATION_EDITOR_TABS,
	type OperationalConfigurationEditorSummary,
	type OperationalConfigurationEditorTab,
	operationalStorageClassRemovalReason,
	removeOperationalEqCapability,
	removeOperationalResidentHomeSlot,
	removeOperationalStorageClass,
	removeOperationalStoragePolicy,
	renameOperationalEqCapability,
	renameOperationalStorageClass,
	replaceOperationalEqGroupQualification,
	replaceOperationalEqPortOverride,
	replaceOperationalResidentHomeSlot,
	replaceOperationalStationCapability,
	replaceOperationalStorageGroup,
	replaceOperationalStoragePolicy,
	replaceOperationalVehicleProfile,
	summarizeOperationalConfigurationEditor,
} from "./OperationalConfigurationEditorModel";
import "./OperationalConfigurationPanel.css";

const VISIBLE_STATION_LIMIT = 200;

export interface OperationalConfigurationPanelProps {
	readonly configuration: OperationalConfigurationState;
	readonly portEquipment: PortEquipmentState;
	readonly source: OperationalConfigurationSourceIdentity;
	readonly busy?: boolean;
	readonly onApply: (replacement: OperationalConfigurationState) => void;
	readonly onReview: () => void;
	readonly onClose: () => void;
	readonly onFocusPort?: (portId: number) => void;
}

export function OperationalConfigurationPanel({
	configuration,
	portEquipment,
	source,
	busy = false,
	onApply,
	onReview,
	onClose,
	onFocusPort,
}: OperationalConfigurationPanelProps): ReactElement {
	const dialogRef = useRef<HTMLElement>(null);
	const [tab, setTab] = useState<OperationalConfigurationEditorTab>("stations");
	const [draft, setDraft] = useState(() => copyOperationalConfigurationState(configuration));
	const [message, setMessage] = useState<string | null>(null);
	const [stationQuery, setStationQuery] = useState("");
	const [stationType, setStationType] = useState<PortType | "ALL">("ALL");
	const eqGroups = useMemo(
		() => portEquipment.equipmentGroups.filter((group) => group.kind === "EQ"),
		[portEquipment.equipmentGroups],
	);
	const storageGroups = useMemo(
		() => portEquipment.equipmentGroups.filter((group) => group.kind !== "EQ"),
		[portEquipment.equipmentGroups],
	);
	const [requestedEqGroupId, setSelectedEqGroupId] = useState<number | null>(
		eqGroups[0]?.id ?? null,
	);
	const [requestedStorageGroupId, setSelectedStorageGroupId] = useState<number | null>(
		storageGroups[0]?.id ?? null,
	);
	const selectedEqGroupId = eqGroups.some((group) => group.id === requestedEqGroupId)
		? requestedEqGroupId
		: (eqGroups[0]?.id ?? null);
	const selectedStorageGroupId = storageGroups.some((group) => group.id === requestedStorageGroupId)
		? requestedStorageGroupId
		: (storageGroups[0]?.id ?? null);
	const summary = useMemo(
		() => summarizeOperationalConfigurationEditor(configuration, draft, portEquipment, source),
		[configuration, draft, portEquipment, source],
	);

	useEffect(() => {
		dialogRef.current?.focus();
	}, []);

	const mutate = (
		operation: (current: OperationalConfigurationState) => OperationalConfigurationState,
	): void => {
		try {
			setDraft(operation(draft));
			setMessage(null);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "운영 설정을 변경할 수 없습니다.");
		}
	};
	const requestClose = (): void => {
		if (summary.draftDirty) {
			setMessage("적용되지 않은 변경이 있습니다. APPLY하거나 REVERT한 뒤 닫으세요.");
			return;
		}
		onClose();
	};
	const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
		if (event.key === "Escape") {
			event.preventDefault();
			requestClose();
			return;
		}
		trapDialogTabNavigation(event);
	};
	const selectedEqGroup = eqGroups.find((group) => group.id === selectedEqGroupId) ?? null;
	const selectedStorageGroup =
		storageGroups.find((group) => group.id === selectedStorageGroupId) ?? null;

	return (
		<div className="tilefab-operational-backdrop" data-testid="operational-configuration-panel">
			<section
				ref={dialogRef}
				className="tilefab-operational-panel"
				role="dialog"
				aria-modal="true"
				aria-labelledby="tilefab-operational-title"
				tabIndex={-1}
				data-tab={tab}
				data-dirty={summary.draftDirty}
				data-ready={summary.ready}
				onKeyDown={handleDialogKeyDown}
			>
				<header className="tilefab-operational-header">
					<span className="tilefab-operational-heading-icon">
						<CircleGauge size={18} />
					</span>
					<span>
						<small>PHASE 6 · EXPLICIT RUN INPUT</small>
						<strong id="tilefab-operational-title">OPERATIONAL CONFIGURATION</strong>
						<em>
							REV {configuration.revision} · SOURCE {source.revision} · {portEquipment.ports.length}{" "}
							PORTS
						</em>
					</span>
					<div className="tilefab-operational-header-state">
						<strong data-state={summary.ready ? "ready" : summary.draftDirty ? "dirty" : "blocked"}>
							{summary.ready ? "REVIEWED" : summary.draftDirty ? "UNAPPLIED" : "DRAFT"}
						</strong>
						<small>{summary.issues.length} ISSUES</small>
					</div>
					<button type="button" aria-label="운영 설정 닫기" onClick={requestClose}>
						<X size={16} />
					</button>
				</header>

				<nav className="tilefab-operational-tabs" aria-label="운영 설정 단계">
					{OPERATIONAL_CONFIGURATION_EDITOR_TABS.map((candidate, index) => (
						<button
							type="button"
							key={candidate}
							data-active={tab === candidate}
							aria-current={tab === candidate ? "step" : undefined}
							onClick={() => setTab(candidate)}
						>
							<small>0{index + 1}</small>
							<span>{tabLabel(candidate)}</span>
						</button>
					))}
				</nav>

				<div className="tilefab-operational-body">
					{tab === "stations" ? (
						<StationsEditor
							draft={draft}
							ports={portEquipment.ports}
							groups={portEquipment.equipmentGroups}
							query={stationQuery}
							portType={stationType}
							onQueryChange={setStationQuery}
							onPortTypeChange={setStationType}
							onChange={(portId, capability) =>
								mutate((current) =>
									replaceOperationalStationCapability(current, portId, capability),
								)
							}
							onFocusPort={onFocusPort}
						/>
					) : null}
					{tab === "eq" ? (
						<EqEditor
							draft={draft}
							portEquipment={portEquipment}
							groups={eqGroups}
							selectedGroup={selectedEqGroup}
							onSelectGroup={setSelectedEqGroupId}
							onMutate={mutate}
							onFocusPort={onFocusPort}
						/>
					) : null}
					{tab === "storage" ? (
						<StorageEditor
							draft={draft}
							groups={storageGroups}
							selectedGroup={selectedStorageGroup}
							onSelectGroup={setSelectedStorageGroupId}
							onMutate={mutate}
						/>
					) : null}
					{tab === "vehicle" ? (
						<VehicleEditor
							key={draft.vehicleProfile ? JSON.stringify(draft.vehicleProfile) : "unresolved"}
							profile={draft.vehicleProfile}
							onChange={(profile) =>
								mutate((current) => replaceOperationalVehicleProfile(current, profile))
							}
							onError={setMessage}
						/>
					) : null}
					{tab === "resident" ? (
						<ResidentFleetEditor draft={draft} ports={portEquipment.ports} onMutate={mutate} />
					) : null}
					{tab === "review" ? (
						<ReviewEditor summary={summary} configuration={draft} source={source} />
					) : null}
				</div>

				{message ? (
					<div className="tilefab-operational-message" role="alert">
						<AlertTriangle size={13} /> {message}
					</div>
				) : null}
				<footer className="tilefab-operational-footer">
					<span>
						<strong>{summary.nonReviewIssues.length}</strong> CONFIGURATION ISSUES
						<small>Simulation remains disabled until exact review and Worker certification.</small>
					</span>
					<button
						type="button"
						className="tilefab-operational-secondary"
						disabled={busy || !summary.draftDirty}
						onClick={() => {
							setDraft(copyOperationalConfigurationState(configuration));
							setMessage(null);
						}}
					>
						<RotateCcw size={13} /> REVERT
					</button>
					<button
						type="button"
						className="tilefab-operational-apply"
						disabled={busy || !summary.draftDirty}
						onClick={() => onApply(draft)}
					>
						<Save size={13} /> APPLY DRAFT
					</button>
					<button
						type="button"
						className="tilefab-operational-review"
						disabled={busy || !summary.canAttachReview}
						onClick={onReview}
					>
						<ShieldCheck size={13} /> REVIEW EXACT SOURCE
					</button>
				</footer>
			</section>
		</div>
	);
}

function StationsEditor({
	draft,
	ports,
	groups,
	query,
	portType,
	onQueryChange,
	onPortTypeChange,
	onChange,
	onFocusPort,
}: {
	readonly draft: OperationalConfigurationState;
	readonly ports: readonly PortRecord[];
	readonly groups: readonly EquipmentGroupRecord[];
	readonly query: string;
	readonly portType: PortType | "ALL";
	readonly onQueryChange: (value: string) => void;
	readonly onPortTypeChange: (value: PortType | "ALL") => void;
	readonly onChange: (
		portId: number,
		capability: OperationalStationTransferCapability | null,
	) => void;
	readonly onFocusPort?: (portId: number) => void;
}): ReactElement {
	const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
	const capabilities = useMemo(
		() => new Map(draft.stationCapabilities.map((record) => [record.portId, record])),
		[draft.stationCapabilities],
	);
	const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
	const filtered = ports.filter((port) => {
		if (portType !== "ALL" && port.portType !== portType) return false;
		if (!normalizedQuery) return true;
		const group = groupsById.get(port.equipmentGroupId);
		return [port.id, port.barcode, port.equipmentGroupId, group?.kind]
			.filter((value) => value !== null && value !== undefined)
			.some((value) => String(value).toLocaleLowerCase("en-US").includes(normalizedQuery));
	});
	const visible = filtered.slice(0, VISIBLE_STATION_LIMIT);

	return (
		<section className="tilefab-operational-section" aria-label="Station transfer capability">
			<header>
				<span>
					<Factory size={16} />
					<strong>STATION TRANSFER ROLE</strong>
				</span>
				<small>
					{draft.stationCapabilities.length}/{ports.length} CONFIGURED
				</small>
			</header>
			<p>
				물리 포트의 방향 표시는 배치 정보입니다. Pickup/Drop-off 가능 여부는 여기서 안정적인 PORT
				ID에 명시합니다.
			</p>
			<div className="tilefab-operational-filterbar">
				<label>
					<Search size={13} />
					<input
						value={query}
						placeholder="Port, barcode, group ID"
						aria-label="운영 station 검색"
						onChange={(event) => onQueryChange(event.currentTarget.value)}
					/>
				</label>
				<select
					value={portType}
					aria-label="Port 종류 필터"
					onChange={(event) => onPortTypeChange(event.currentTarget.value as PortType | "ALL")}
				>
					<option value="ALL">ALL TYPES</option>
					<option value="EQ">EQ</option>
					<option value="OHB">OHB</option>
					<option value="STK">STK</option>
				</select>
				<small>{filtered.length} MATCHES</small>
			</div>
			<div className="tilefab-operational-table">
				<div className="tilefab-operational-table-head">
					<span>PORT / PHYSICAL GROUP</span>
					<span>LAYOUT</span>
					<span>TRANSFER ROLE</span>
				</div>
				{visible.map((port) => {
					const group = groupsById.get(port.equipmentGroupId);
					const current = capabilities.get(port.id)?.transferCapability ?? "";
					return (
						<div className="tilefab-operational-table-row" key={port.id}>
							<button
								type="button"
								className="tilefab-operational-object-link"
								disabled={!onFocusPort}
								onClick={() => onFocusPort?.(port.id)}
							>
								<strong>{port.barcode ?? `PORT-${port.id}`}</strong>
								<small>
									PORT-{port.id} · {group?.kind ?? port.portType}-{port.equipmentGroupId}
								</small>
							</button>
							<span>
								<strong>{port.portType}</strong>
								<small>
									{port.direction.replace("_", " ")} · {port.side}
								</small>
							</span>
							<select
								value={current}
								aria-label={`PORT-${port.id} transfer role`}
								data-configured={current !== ""}
								onChange={(event) =>
									onChange(
										port.id,
										event.currentTarget.value
											? (event.currentTarget.value as OperationalStationTransferCapability)
											: null,
									)
								}
							>
								<option value="">UNRESOLVED</option>
								{OPERATIONAL_STATION_TRANSFER_CAPABILITIES.map((capability) => (
									<option key={capability} value={capability}>
										{capability.replace("_", " + ")}
									</option>
								))}
							</select>
						</div>
					);
				})}
			</div>
			{filtered.length > visible.length ? (
				<small className="tilefab-operational-overflow">
					Showing first {visible.length}. Refine the search to edit the remaining rows.
				</small>
			) : null}
		</section>
	);
}

function EqEditor({
	draft,
	portEquipment,
	groups,
	selectedGroup,
	onSelectGroup,
	onMutate,
	onFocusPort,
}: {
	readonly draft: OperationalConfigurationState;
	readonly portEquipment: PortEquipmentState;
	readonly groups: readonly EquipmentGroupRecord[];
	readonly selectedGroup: EquipmentGroupRecord | null;
	readonly onSelectGroup: (groupId: number) => void;
	readonly onMutate: (
		operation: (current: OperationalConfigurationState) => OperationalConfigurationState,
	) => void;
	readonly onFocusPort?: (portId: number) => void;
}): ReactElement {
	const groupQualification = selectedGroup
		? (draft.eqGroupQualifications.find((record) => record.equipmentGroupId === selectedGroup.id) ??
			null)
		: null;
	const portsById = useMemo(
		() => new Map(portEquipment.ports.map((port) => [port.id, port])),
		[portEquipment.ports],
	);

	return (
		<section className="tilefab-operational-section" aria-label="EQ capability configuration">
			<header>
				<span>
					<Database size={16} />
					<strong>EQ CAPABILITIES</strong>
				</span>
				<small>{draft.eqCapabilities.length} DEFINITIONS</small>
			</header>
			<p>
				공정 capability는 논리 정의이며 물리 EQ 그룹이 기본값을 가집니다. Port override는 예외
				포트에서 그룹 기본값을 완전히 대체합니다.
			</p>
			<DefinitionEditor
				label="CAPABILITY"
				definitions={draft.eqCapabilities}
				onAdd={(key) => onMutate((current) => addOperationalEqCapability(current, key))}
				onRename={(id, key) =>
					onMutate((current) => renameOperationalEqCapability(current, id, key))
				}
				onRemove={(id) => onMutate((current) => removeOperationalEqCapability(current, id))}
			/>
			<div className="tilefab-operational-object-selector">
				<label htmlFor="tilefab-operational-eq-group">PHYSICAL EQ GROUP</label>
				<select
					id="tilefab-operational-eq-group"
					value={selectedGroup?.id ?? ""}
					onChange={(event) => onSelectGroup(Number(event.currentTarget.value))}
				>
					{groups.length === 0 ? <option value="">NO EQ GROUPS</option> : null}
					{groups.map((group) => (
						<option key={group.id} value={group.id}>
							EQ-{group.id} · {group.portIds.length} PORTS
						</option>
					))}
				</select>
			</div>
			{selectedGroup ? (
				<div className="tilefab-operational-policy-card">
					<header>
						<span>
							<Factory size={14} /> EQ-{selectedGroup.id}
						</span>
						<small>{selectedGroup.portIds.length} PHYSICAL PORTS</small>
					</header>
					<CapabilityChecklist
						label="GROUP DEFAULT"
						definitions={draft.eqCapabilities}
						configured={groupQualification !== null}
						selectedIds={groupQualification?.capabilityIds ?? []}
						onChange={(ids) =>
							onMutate((current) =>
								replaceOperationalEqGroupQualification(current, selectedGroup.id, ids),
							)
						}
					/>
					<div className="tilefab-operational-port-overrides">
						<header>
							<strong>PORT OVERRIDES</strong>
							<small>OPTIONAL · REPLACES GROUP DEFAULT</small>
						</header>
						{selectedGroup.portIds.map((portId) => {
							const port = portsById.get(portId);
							const override = draft.eqPortQualificationOverrides.find(
								(record) => record.portId === portId,
							);
							return (
								<div className="tilefab-operational-override-row" key={portId}>
									<button
										type="button"
										disabled={!onFocusPort}
										onClick={() => onFocusPort?.(portId)}
									>
										<strong>{port?.barcode ?? `PORT-${portId}`}</strong>
										<small>PORT-{portId}</small>
									</button>
									<CapabilityChecklist
										label={`PORT-${portId}`}
										compact
										definitions={draft.eqCapabilities}
										configured={override !== undefined}
										selectedIds={override?.capabilityIds ?? []}
										onChange={(ids) =>
											onMutate((current) => replaceOperationalEqPortOverride(current, portId, ids))
										}
									/>
								</div>
							);
						})}
					</div>
				</div>
			) : (
				<EmptyOperationalState label="No physical EQ groups in the current project." />
			)}
		</section>
	);
}

function StorageEditor({
	draft,
	groups,
	selectedGroup,
	onSelectGroup,
	onMutate,
}: {
	readonly draft: OperationalConfigurationState;
	readonly groups: readonly EquipmentGroupRecord[];
	readonly selectedGroup: EquipmentGroupRecord | null;
	readonly onSelectGroup: (groupId: number) => void;
	readonly onMutate: (
		operation: (current: OperationalConfigurationState) => OperationalConfigurationState,
	) => void;
}): ReactElement {
	const groupConfiguration = selectedGroup
		? (draft.storageGroups.find((record) => record.equipmentGroupId === selectedGroup.id) ?? null)
		: null;
	return (
		<section className="tilefab-operational-section" aria-label="OHB and STK storage configuration">
			<header>
				<span>
					<Warehouse size={16} />
					<strong>OHB / STK STORAGE POLICY</strong>
				</span>
				<small>
					{draft.storageGroups.length}/{groups.length} GROUPS
				</small>
			</header>
			<p>
				저장 클래스와 정책은 논리 정의입니다. Capacity, initial occupancy, HWM은 현재 물리 OHB/STK
				그룹 ID에 명시적으로 연결됩니다.
			</p>
			<div className="tilefab-operational-definition-grid">
				<DefinitionEditor
					label="STORAGE CLASS"
					definitions={draft.storageClasses}
					onAdd={(key) => onMutate((current) => addOperationalStorageClass(current, key))}
					onRename={(id, key) =>
						onMutate((current) => renameOperationalStorageClass(current, id, key))
					}
					onRemove={(id) => onMutate((current) => removeOperationalStorageClass(current, id))}
					removalReason={(id) => operationalStorageClassRemovalReason(draft, id)}
				/>
				<StoragePolicyEditor draft={draft} onMutate={onMutate} />
			</div>
			<div className="tilefab-operational-object-selector">
				<label htmlFor="tilefab-operational-storage-group">PHYSICAL STORAGE GROUP</label>
				<select
					id="tilefab-operational-storage-group"
					value={selectedGroup?.id ?? ""}
					onChange={(event) => onSelectGroup(Number(event.currentTarget.value))}
				>
					{groups.length === 0 ? <option value="">NO OHB / STK GROUPS</option> : null}
					{groups.map((group) => (
						<option key={group.id} value={group.id}>
							{group.kind}-{group.id} · {group.portIds.length} PORTS
						</option>
					))}
				</select>
			</div>
			{selectedGroup ? (
				<StorageGroupEditor
					key={`${selectedGroup.id}:${groupConfiguration?.policyId ?? 0}:${groupConfiguration?.capacityUnits ?? 0}`}
					group={selectedGroup}
					configuration={groupConfiguration}
					policies={draft.storagePolicies}
					onCommit={(record) =>
						onMutate((current) => replaceOperationalStorageGroup(current, record, selectedGroup.id))
					}
				/>
			) : (
				<EmptyOperationalState label="No physical OHB or STK groups in the current project." />
			)}
		</section>
	);
}

function VehicleEditor({
	profile,
	onChange,
	onError,
}: {
	readonly profile: OperationalVehicleReservationProfile | null;
	readonly onChange: (profile: OperationalVehicleReservationProfile | null) => void;
	readonly onError: (message: string | null) => void;
}): ReactElement {
	const [form, setForm] = useState(() => vehicleFormFromProfile(profile));
	const update = (key: keyof VehicleProfileForm, value: string): void =>
		setForm((current) => ({ ...current, [key]: value }));
	const save = (): void => {
		try {
			onChange(vehicleProfileFromForm(form));
			onError(null);
		} catch (error) {
			onError(error instanceof Error ? error.message : "Vehicle profile is invalid.");
		}
	};

	return (
		<section className="tilefab-operational-section" aria-label="OHT reservation profile">
			<header>
				<span>
					<Truck size={16} />
					<strong>VEHICLE RESERVATION PROFILE</strong>
				</span>
				<small>{profile ? profile.id : "UNRESOLVED"}</small>
			</header>
			<p>
				제품 기본값을 만들지 않습니다. 차체, 제동, 반응, 안전 여유를 명시해야 track resource 점유
				범위를 검증할 수 있습니다.
			</p>
			<div className="tilefab-operational-form-grid">
				<OperationalTextField
					label="PROFILE ID"
					value={form.id}
					onChange={(value) => update("id", value)}
				/>
				<OperationalNumberField
					label="VERSION"
					value={form.version}
					onChange={(value) => update("version", value)}
				/>
				<OperationalNumberField
					label="BODY LENGTH (mm)"
					value={form.bodyLengthMillimeters}
					onChange={(value) => update("bodyLengthMillimeters", value)}
				/>
				<OperationalNumberField
					label="REFERENCE → FRONT (mm)"
					value={form.referenceToFrontMillimeters}
					onChange={(value) => update("referenceToFrontMillimeters", value)}
				/>
				<OperationalNumberField
					label="REFERENCE → REAR (mm)"
					value={form.referenceToRearMillimeters}
					onChange={(value) => update("referenceToRearMillimeters", value)}
				/>
				<OperationalNumberField
					label="BODY WIDTH (mm)"
					value={form.bodyWidthMillimeters}
					onChange={(value) => update("bodyWidthMillimeters", value)}
				/>
				<OperationalNumberField
					label="LATERAL MARGIN (mm)"
					value={form.lateralSafetyMarginMillimeters}
					onChange={(value) => update("lateralSafetyMarginMillimeters", value)}
				/>
				<OperationalNumberField
					label="FRONT MARGIN (mm)"
					value={form.frontSafetyMarginMillimeters}
					onChange={(value) => update("frontSafetyMarginMillimeters", value)}
				/>
				<OperationalNumberField
					label="REAR MARGIN (mm)"
					value={form.rearSafetyMarginMillimeters}
					onChange={(value) => update("rearSafetyMarginMillimeters", value)}
				/>
				<OperationalNumberField
					label="MAX SPEED (mm/s)"
					value={form.maximumSpeedMillimetersPerSecond}
					onChange={(value) => update("maximumSpeedMillimetersPerSecond", value)}
				/>
				<OperationalNumberField
					label="CONTROL REACTION (ms)"
					value={form.controlReactionMilliseconds}
					onChange={(value) => update("controlReactionMilliseconds", value)}
				/>
				<OperationalNumberField
					label="MIN DECELERATION (mm/s²)"
					value={form.minimumServiceDecelerationMillimetersPerSecondSquared}
					onChange={(value) =>
						update("minimumServiceDecelerationMillimetersPerSecondSquared", value)
					}
				/>
			</div>
			<div className="tilefab-operational-inline-actions">
				<button type="button" className="tilefab-operational-primary" onClick={save}>
					<Save size={13} /> {profile ? "UPDATE PROFILE" : "SET PROFILE"}
				</button>
				<button type="button" disabled={!profile} onClick={() => onChange(null)}>
					<Trash2 size={13} /> CLEAR
				</button>
			</div>
		</section>
	);
}

function ResidentFleetEditor({
	draft,
	ports,
	onMutate,
}: {
	readonly draft: OperationalConfigurationState;
	readonly ports: readonly PortRecord[];
	readonly onMutate: (
		operation: (current: OperationalConfigurationState) => OperationalConfigurationState,
	) => void;
}): ReactElement {
	const [vehicleId, setVehicleId] = useState("");
	const [anchorPortId, setAnchorPortId] = useState(ports[0] ? String(ports[0].id) : "");
	const canAdd =
		vehicleId.trim().length > 0 &&
		anchorPortId.length > 0 &&
		draft.residentHomeSlots.length < OPERATIONAL_RESIDENT_HOME_SLOT_LIMIT;
	return (
		<section className="tilefab-operational-section" aria-label="Resident fleet home slots">
			<header>
				<span>
					<Home size={16} />
					<strong>RESIDENT FLEET HOME SLOTS</strong>
				</span>
				<small>
					{draft.residentHomeSlots.length}/{OPERATIONAL_RESIDENT_HOME_SLOT_LIMIT} ASSIGNED
				</small>
			</header>
			<div className="tilefab-operational-resident-warning">
				<AlertTriangle size={14} />
				<span>
					<strong>EXPLICIT ASSIGNMENT · SEPARATE RESIDENT CERTIFICATION REQUIRED</strong>
					<small>
						Each vehicle owns one explicit stable port. A home assignment alone never creates
						resident Run authority.
					</small>
				</span>
			</div>
			<div className="tilefab-operational-resident-table">
				<div className="tilefab-operational-resident-head">
					<span>SLOT</span>
					<span>VEHICLE ID</span>
					<span>EXPLICIT HOME PORT</span>
					<span>POLICY</span>
					<span>ACTION</span>
				</div>
				{draft.residentHomeSlots.map((slot) => (
					<ResidentHomeSlotRow
						key={slot.id}
						slot={slot}
						ports={ports}
						onCommit={(record) =>
							onMutate((current) => replaceOperationalResidentHomeSlot(current, record))
						}
						onRemove={() =>
							onMutate((current) => removeOperationalResidentHomeSlot(current, slot.id))
						}
					/>
				))}
				{draft.residentHomeSlots.length === 0 ? (
					<div className="tilefab-operational-empty">
						<Home size={15} /> NO EXPLICIT HOME SLOTS
					</div>
				) : null}
			</div>
			<form
				className="tilefab-operational-resident-form"
				onSubmit={(event) => {
					event.preventDefault();
					if (!canAdd) return;
					onMutate((current) =>
						addOperationalResidentHomeSlot(current, vehicleId.trim(), Number(anchorPortId)),
					);
					setVehicleId("");
				}}
			>
				<input
					value={vehicleId}
					maxLength={120}
					placeholder="Vehicle ID, e.g. OHT-001"
					aria-label="New resident vehicle ID"
					onChange={(event) => setVehicleId(event.currentTarget.value)}
				/>
				<select
					value={anchorPortId}
					aria-label="New resident home port"
					onChange={(event) => setAnchorPortId(event.currentTarget.value)}
				>
					{ports.length === 0 ? <option value="">NO PERSISTENT PORTS</option> : null}
					{ports.map((port) => (
						<option key={port.id} value={port.id}>
							{residentPortLabel(port)}
						</option>
					))}
				</select>
				<button type="submit" disabled={!canAdd}>
					ADD HOME SLOT
				</button>
			</form>
		</section>
	);
}

function ResidentHomeSlotRow({
	slot,
	ports,
	onCommit,
	onRemove,
}: {
	readonly slot: OperationalConfigurationState["residentHomeSlots"][number];
	readonly ports: readonly PortRecord[];
	readonly onCommit: (record: OperationalConfigurationState["residentHomeSlots"][number]) => void;
	readonly onRemove: () => void;
}): ReactElement {
	const [vehicleId, setVehicleId] = useState(slot.vehicleId);
	const [anchorPortId, setAnchorPortId] = useState(String(slot.anchorPortId));
	const anchorExists = ports.some((port) => port.id === slot.anchorPortId);
	const commit = (nextVehicleId = vehicleId, nextAnchorPortId = anchorPortId): void => {
		const trimmedVehicleId = nextVehicleId.trim();
		if (!trimmedVehicleId || !nextAnchorPortId) return;
		const next = {
			id: slot.id,
			vehicleId: trimmedVehicleId,
			anchorPortId: Number(nextAnchorPortId),
			policy: OPERATIONAL_RESIDENT_HOME_SLOT_POLICY,
		};
		if (next.vehicleId !== slot.vehicleId || next.anchorPortId !== slot.anchorPortId) {
			onCommit(next);
		}
	};
	return (
		<div className="tilefab-operational-resident-row" data-anchor-current={anchorExists}>
			<small>#{slot.id}</small>
			<input
				value={vehicleId}
				maxLength={120}
				aria-label={`Resident slot ${slot.id} vehicle ID`}
				onChange={(event) => setVehicleId(event.currentTarget.value)}
				onBlur={() => commit()}
			/>
			<select
				value={anchorPortId}
				aria-label={`Resident slot ${slot.id} home port`}
				onChange={(event) => {
					const nextAnchorPortId = event.currentTarget.value;
					setAnchorPortId(nextAnchorPortId);
					commit(vehicleId, nextAnchorPortId);
				}}
			>
				{!anchorExists ? (
					<option value={slot.anchorPortId}>MISSING PORT-{slot.anchorPortId}</option>
				) : null}
				{ports.map((port) => (
					<option key={port.id} value={port.id}>
						{residentPortLabel(port)}
					</option>
				))}
			</select>
			<small>{slot.policy.replaceAll("_", " ")}</small>
			<button type="button" aria-label={`Remove resident home slot ${slot.id}`} onClick={onRemove}>
				<Trash2 size={12} />
			</button>
		</div>
	);
}

function residentPortLabel(port: PortRecord): string {
	return `${port.barcode ?? `PORT-${port.id}`} · ${port.portType}-${port.equipmentGroupId} · PORT-${port.id}`;
}

function ReviewEditor({
	summary,
	configuration,
	source,
}: {
	readonly summary: OperationalConfigurationEditorSummary;
	readonly configuration: OperationalConfigurationState;
	readonly source: OperationalConfigurationSourceIdentity;
}): ReactElement {
	return (
		<section className="tilefab-operational-section" aria-label="Operational readiness review">
			<header>
				<span>
					<ShieldCheck size={16} />
					<strong>EXACT REVIEW</strong>
				</span>
				<small>{summary.reviewCurrent ? "CURRENT" : "REQUIRED"}</small>
			</header>
			<div className="tilefab-operational-review-summary" data-ready={summary.ready}>
				<span>{summary.ready ? <Check size={20} /> : <AlertTriangle size={20} />}</span>
				<div>
					<strong>
						{summary.ready
							? "CONFIGURATION REVIEW MATCHES THIS STATIC SOURCE"
							: summary.draftDirty
								? "APPLY THE DRAFT BEFORE REVIEW"
								: `${summary.nonReviewIssues.length} CONFIGURATION ISSUES REMAIN`}
					</strong>
					<small>
						SOURCE REV {source.revision} · CONFIG REV {configuration.revision}
					</small>
				</div>
			</div>
			<dl className="tilefab-operational-review-facts">
				<div>
					<dt>STATIONS</dt>
					<dd>{configuration.stationCapabilities.length}</dd>
				</div>
				<div>
					<dt>EQ CAPABILITIES</dt>
					<dd>{configuration.eqCapabilities.length}</dd>
				</div>
				<div>
					<dt>EQ GROUPS</dt>
					<dd>{configuration.eqGroupQualifications.length}</dd>
				</div>
				<div>
					<dt>PORT OVERRIDES</dt>
					<dd>{configuration.eqPortQualificationOverrides.length}</dd>
				</div>
				<div>
					<dt>STORAGE CLASSES</dt>
					<dd>{configuration.storageClasses.length}</dd>
				</div>
				<div>
					<dt>STORAGE POLICIES</dt>
					<dd>{configuration.storagePolicies.length}</dd>
				</div>
				<div>
					<dt>STORAGE GROUPS</dt>
					<dd>{configuration.storageGroups.length}</dd>
				</div>
				<div>
					<dt>VEHICLE PROFILE</dt>
					<dd>{configuration.vehicleProfile ? "SET" : "MISSING"}</dd>
				</div>
				<div>
					<dt>RESIDENT HOME SLOTS</dt>
					<dd>{configuration.residentHomeSlots.length}</dd>
				</div>
			</dl>
			<div className="tilefab-operational-issue-list">
				{summary.issues.length === 0 ? (
					<div className="tilefab-operational-empty" data-ready="true">
						<Check size={16} /> No unresolved operational configuration issues.
					</div>
				) : (
					summary.issues.map((issue) => (
						<div
							key={`${issue.code}:${issue.portIds.join(",")}:${issue.equipmentGroupIds.join(",")}:${issue.message}`}
							data-review-issue={issue.code.startsWith("REVIEW_")}
						>
							<AlertTriangle size={13} />
							<span>
								<strong>{issue.code.replaceAll("_", " ")}</strong>
								<small>{issue.message}</small>
							</span>
							<em>{issue.portIds.length + issue.equipmentGroupIds.length || 1}</em>
						</div>
					))
				)}
			</div>
		</section>
	);
}

function DefinitionEditor({
	label,
	definitions,
	onAdd,
	onRename,
	onRemove,
	removalReason,
}: {
	readonly label: string;
	readonly definitions: readonly OperationalLogicalDefinition[];
	readonly onAdd: (key: string) => void;
	readonly onRename: (id: number, key: string) => void;
	readonly onRemove: (id: number) => void;
	readonly removalReason?: (id: number) => string | null;
}): ReactElement {
	const [newKey, setNewKey] = useState("");
	return (
		<section className="tilefab-operational-definitions">
			<header>
				<strong>{label}</strong>
				<small>{definitions.length}</small>
			</header>
			<div>
				{definitions.map((definition) => (
					<EditableDefinitionRow
						key={`${definition.id}:${definition.key}`}
						definition={definition}
						onRename={onRename}
						onRemove={onRemove}
						removalReason={removalReason?.(definition.id) ?? null}
					/>
				))}
				{definitions.length === 0 ? (
					<small className="tilefab-operational-none">NO DEFINITIONS</small>
				) : null}
			</div>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					const key = newKey.trim();
					if (!key) return;
					onAdd(key);
					setNewKey("");
				}}
			>
				<input
					value={newKey}
					maxLength={120}
					placeholder={`New ${label.toLocaleLowerCase("en-US")}`}
					aria-label={`New ${label}`}
					onChange={(event) => setNewKey(event.currentTarget.value)}
				/>
				<button type="submit" disabled={!newKey.trim()}>
					ADD
				</button>
			</form>
		</section>
	);
}

function EditableDefinitionRow({
	definition,
	onRename,
	onRemove,
	removalReason,
}: {
	readonly definition: OperationalLogicalDefinition;
	readonly onRename: (id: number, key: string) => void;
	readonly onRemove: (id: number) => void;
	readonly removalReason: string | null;
}): ReactElement {
	const [key, setKey] = useState(definition.key);
	return (
		<div className="tilefab-operational-definition-row">
			<small>#{definition.id}</small>
			<input
				value={key}
				maxLength={120}
				aria-label={`Definition ${definition.id}`}
				onChange={(event) => setKey(event.currentTarget.value)}
				onBlur={() => {
					const next = key.trim();
					if (next && next !== definition.key) onRename(definition.id, next);
					else setKey(definition.key);
				}}
			/>
			<button
				type="button"
				aria-label={`Remove definition ${definition.id}`}
				disabled={removalReason !== null}
				title={removalReason ?? "Remove definition"}
				onClick={() => onRemove(definition.id)}
			>
				<Trash2 size={12} />
			</button>
		</div>
	);
}

function CapabilityChecklist({
	label,
	definitions,
	configured,
	selectedIds,
	onChange,
	compact = false,
}: {
	readonly label: string;
	readonly definitions: readonly OperationalLogicalDefinition[];
	readonly configured: boolean;
	readonly selectedIds: readonly number[];
	readonly onChange: (ids: readonly number[] | null) => void;
	readonly compact?: boolean;
}): ReactElement {
	const selected = new Set(selectedIds);
	return (
		<fieldset className="tilefab-operational-capability-list" data-compact={compact}>
			<legend>{label}</legend>
			{definitions.map((definition) => (
				<label key={definition.id}>
					<input
						type="checkbox"
						checked={selected.has(definition.id)}
						onChange={() => {
							const next = new Set(configured ? selectedIds : []);
							if (next.has(definition.id)) next.delete(definition.id);
							else next.add(definition.id);
							onChange([...next]);
						}}
					/>
					<span>{definition.key}</span>
				</label>
			))}
			{definitions.length === 0 ? <small>Define a capability first.</small> : null}
			<button
				type="button"
				data-configured={configured}
				onClick={() => onChange(configured ? null : [])}
			>
				{configured ? "USE INHERITED / UNSET" : "CONFIGURE EMPTY SET"}
			</button>
		</fieldset>
	);
}

function StoragePolicyEditor({
	draft,
	onMutate,
}: {
	readonly draft: OperationalConfigurationState;
	readonly onMutate: (
		operation: (current: OperationalConfigurationState) => OperationalConfigurationState,
	) => void;
}): ReactElement {
	const [key, setKey] = useState("");
	const [storageClassId, setStorageClassId] = useState("");
	const [priorityRank, setPriorityRank] = useState("");
	const [dwell, setDwell] = useState("");
	const canAdd =
		key.trim() &&
		isUnsignedInteger(storageClassId, false) &&
		isUnsignedInteger(priorityRank, true) &&
		isUnsignedInteger(dwell, true);
	return (
		<section className="tilefab-operational-definitions tilefab-operational-policies">
			<header>
				<strong>STORAGE POLICY</strong>
				<small>{draft.storagePolicies.length}</small>
			</header>
			<div>
				{draft.storagePolicies.map((policy) => (
					<StoragePolicyRow
						key={policy.id}
						policy={policy}
						classes={draft.storageClasses}
						onCommit={(next) =>
							onMutate((current) => replaceOperationalStoragePolicy(current, next))
						}
						onRemove={() =>
							onMutate((current) => removeOperationalStoragePolicy(current, policy.id))
						}
					/>
				))}
				{draft.storagePolicies.length === 0 ? (
					<small className="tilefab-operational-none">NO POLICIES</small>
				) : null}
			</div>
			<form
				className="tilefab-operational-policy-form"
				onSubmit={(event) => {
					event.preventDefault();
					if (!canAdd) return;
					onMutate((current) =>
						addOperationalStoragePolicy(current, {
							key: key.trim(),
							storageClassId: Number(storageClassId),
							priorityRank: Number(priorityRank),
							minimumDwellMilliseconds: Number(dwell),
						}),
					);
					setKey("");
					setStorageClassId("");
					setPriorityRank("");
					setDwell("");
				}}
			>
				<input
					value={key}
					maxLength={120}
					placeholder="Policy key"
					aria-label="New storage policy key"
					onChange={(event) => setKey(event.currentTarget.value)}
				/>
				<select
					value={storageClassId}
					aria-label="New policy storage class"
					onChange={(event) => setStorageClassId(event.currentTarget.value)}
				>
					<option value="">CLASS</option>
					{draft.storageClasses.map((definition) => (
						<option key={definition.id} value={definition.id}>
							{definition.key}
						</option>
					))}
				</select>
				<input
					type="number"
					min="0"
					max="65535"
					value={priorityRank}
					placeholder="Priority"
					aria-label="New policy priority rank"
					onChange={(event) => setPriorityRank(event.currentTarget.value)}
				/>
				<input
					type="number"
					min="0"
					max="4294967295"
					value={dwell}
					placeholder="Dwell ms"
					aria-label="New policy dwell milliseconds"
					onChange={(event) => setDwell(event.currentTarget.value)}
				/>
				<button type="submit" disabled={!canAdd}>
					ADD
				</button>
			</form>
		</section>
	);
}

function StoragePolicyRow({
	policy,
	classes,
	onCommit,
	onRemove,
}: {
	readonly policy: OperationalStoragePolicyDefinition;
	readonly classes: readonly OperationalLogicalDefinition[];
	readonly onCommit: (policy: OperationalStoragePolicyDefinition) => void;
	readonly onRemove: () => void;
}): ReactElement {
	const [form, setForm] = useState({
		key: policy.key,
		storageClassId: String(policy.storageClassId),
		priorityRank: String(policy.priorityRank),
		dwell: String(policy.minimumDwellMilliseconds),
	});
	const commit = (): void => {
		if (
			!form.key.trim() ||
			!isUnsignedInteger(form.storageClassId, false) ||
			!isUnsignedInteger(form.priorityRank, true) ||
			!isUnsignedInteger(form.dwell, true)
		)
			return;
		const next = {
			id: policy.id,
			key: form.key.trim(),
			storageClassId: Number(form.storageClassId),
			priorityRank: Number(form.priorityRank),
			minimumDwellMilliseconds: Number(form.dwell),
		};
		if (JSON.stringify(next) !== JSON.stringify(policy)) onCommit(next);
	};
	return (
		<div className="tilefab-operational-policy-row">
			<small>#{policy.id}</small>
			<input
				value={form.key}
				aria-label={`Policy ${policy.id} key`}
				onChange={(event) => setForm({ ...form, key: event.currentTarget.value })}
				onBlur={commit}
			/>
			<select
				value={form.storageClassId}
				aria-label={`Policy ${policy.id} class`}
				onChange={(event) => {
					const next = { ...form, storageClassId: event.currentTarget.value };
					setForm(next);
					onCommit({ ...policy, storageClassId: Number(next.storageClassId) });
				}}
			>
				{classes.map((definition) => (
					<option key={definition.id} value={definition.id}>
						{definition.key}
					</option>
				))}
			</select>
			<input
				type="number"
				min="0"
				max="65535"
				value={form.priorityRank}
				aria-label={`Policy ${policy.id} priority`}
				onChange={(event) => setForm({ ...form, priorityRank: event.currentTarget.value })}
				onBlur={commit}
			/>
			<input
				type="number"
				min="0"
				max="4294967295"
				value={form.dwell}
				aria-label={`Policy ${policy.id} dwell`}
				onChange={(event) => setForm({ ...form, dwell: event.currentTarget.value })}
				onBlur={commit}
			/>
			<button type="button" aria-label={`Remove policy ${policy.id}`} onClick={onRemove}>
				<Trash2 size={12} />
			</button>
		</div>
	);
}

function StorageGroupEditor({
	group,
	configuration,
	policies,
	onCommit,
}: {
	readonly group: EquipmentGroupRecord;
	readonly configuration: OperationalStorageGroupConfigurationRecord | null;
	readonly policies: readonly OperationalStoragePolicyDefinition[];
	readonly onCommit: (record: OperationalStorageGroupConfigurationRecord | null) => void;
}): ReactElement {
	const [form, setForm] = useState({
		policyId: configuration ? String(configuration.policyId) : "",
		capacityUnits: configuration ? String(configuration.capacityUnits) : "",
		initialOccupiedUnits: configuration ? String(configuration.initialOccupiedUnits) : "",
		highWaterMarkUnits: configuration ? String(configuration.highWaterMarkUnits) : "",
	});
	const capacity = Number(form.capacityUnits);
	const occupied = Number(form.initialOccupiedUnits);
	const hwm = Number(form.highWaterMarkUnits);
	const valid =
		isUnsignedInteger(form.policyId, false) &&
		isUnsignedInteger(form.capacityUnits, false) &&
		isUnsignedInteger(form.initialOccupiedUnits, true) &&
		isUnsignedInteger(form.highWaterMarkUnits, true) &&
		occupied <= capacity &&
		hwm <= capacity;
	return (
		<section className="tilefab-operational-policy-card">
			<header>
				<span>
					<Warehouse size={14} /> {group.kind}-{group.id}
				</span>
				<small>{group.portIds.length} PHYSICAL PORTS</small>
			</header>
			<div className="tilefab-operational-form-grid">
				<label>
					<span>POLICY</span>
					<select
						value={form.policyId}
						onChange={(event) => setForm({ ...form, policyId: event.currentTarget.value })}
					>
						<option value="">UNRESOLVED</option>
						{policies.map((policy) => (
							<option key={policy.id} value={policy.id}>
								{policy.key}
							</option>
						))}
					</select>
				</label>
				<OperationalNumberField
					label="CAPACITY UNITS"
					value={form.capacityUnits}
					onChange={(value) => setForm({ ...form, capacityUnits: value })}
				/>
				<OperationalNumberField
					label="INITIAL OCCUPIED"
					value={form.initialOccupiedUnits}
					onChange={(value) => setForm({ ...form, initialOccupiedUnits: value })}
				/>
				<OperationalNumberField
					label="HIGH-WATER MARK"
					value={form.highWaterMarkUnits}
					onChange={(value) => setForm({ ...form, highWaterMarkUnits: value })}
				/>
			</div>
			<div className="tilefab-operational-inline-actions">
				<button
					type="button"
					className="tilefab-operational-primary"
					disabled={!valid}
					onClick={() =>
						onCommit({
							equipmentGroupId: group.id,
							policyId: Number(form.policyId),
							capacityUnits: capacity,
							initialOccupiedUnits: occupied,
							highWaterMarkUnits: hwm,
						})
					}
				>
					<Save size={13} /> {configuration ? "UPDATE GROUP" : "SET GROUP"}
				</button>
				<button type="button" disabled={!configuration} onClick={() => onCommit(null)}>
					<Trash2 size={13} /> CLEAR
				</button>
			</div>
		</section>
	);
}

function OperationalTextField({
	label,
	value,
	onChange,
}: {
	readonly label: string;
	readonly value: string;
	readonly onChange: (value: string) => void;
}): ReactElement {
	return (
		<label>
			<span>{label}</span>
			<input
				value={value}
				maxLength={120}
				onChange={(event) => onChange(event.currentTarget.value)}
			/>
		</label>
	);
}
function OperationalNumberField({
	label,
	value,
	onChange,
}: {
	readonly label: string;
	readonly value: string;
	readonly onChange: (value: string) => void;
}): ReactElement {
	return (
		<label>
			<span>{label}</span>
			<input
				type="number"
				min="0"
				max="4294967295"
				step="1"
				value={value}
				onChange={(event) => onChange(event.currentTarget.value)}
			/>
		</label>
	);
}
function EmptyOperationalState({ label }: { readonly label: string }): ReactElement {
	return (
		<div className="tilefab-operational-empty">
			<Warehouse size={16} /> {label}
		</div>
	);
}

interface VehicleProfileForm {
	readonly id: string;
	readonly version: string;
	readonly bodyLengthMillimeters: string;
	readonly referenceToFrontMillimeters: string;
	readonly referenceToRearMillimeters: string;
	readonly bodyWidthMillimeters: string;
	readonly lateralSafetyMarginMillimeters: string;
	readonly frontSafetyMarginMillimeters: string;
	readonly rearSafetyMarginMillimeters: string;
	readonly maximumSpeedMillimetersPerSecond: string;
	readonly controlReactionMilliseconds: string;
	readonly minimumServiceDecelerationMillimetersPerSecondSquared: string;
}
function vehicleFormFromProfile(
	profile: OperationalVehicleReservationProfile | null,
): VehicleProfileForm {
	return {
		id: profile?.id ?? "",
		version: profile ? String(profile.version) : "",
		bodyLengthMillimeters: profile ? String(profile.bodyLengthMillimeters) : "",
		referenceToFrontMillimeters: profile ? String(profile.referenceToFrontMillimeters) : "",
		referenceToRearMillimeters: profile ? String(profile.referenceToRearMillimeters) : "",
		bodyWidthMillimeters: profile ? String(profile.bodyWidthMillimeters) : "",
		lateralSafetyMarginMillimeters: profile ? String(profile.lateralSafetyMarginMillimeters) : "",
		frontSafetyMarginMillimeters: profile ? String(profile.frontSafetyMarginMillimeters) : "",
		rearSafetyMarginMillimeters: profile ? String(profile.rearSafetyMarginMillimeters) : "",
		maximumSpeedMillimetersPerSecond: profile
			? String(profile.maximumSpeedMillimetersPerSecond)
			: "",
		controlReactionMilliseconds: profile ? String(profile.controlReactionMilliseconds) : "",
		minimumServiceDecelerationMillimetersPerSecondSquared: profile
			? String(profile.minimumServiceDecelerationMillimetersPerSecondSquared)
			: "",
	};
}
function vehicleProfileFromForm(form: VehicleProfileForm): OperationalVehicleReservationProfile {
	const id = form.id.trim();
	if (!id) throw new Error("Vehicle profile ID is required.");
	const numericKeys = [
		"version",
		"bodyLengthMillimeters",
		"referenceToFrontMillimeters",
		"referenceToRearMillimeters",
		"bodyWidthMillimeters",
		"lateralSafetyMarginMillimeters",
		"frontSafetyMarginMillimeters",
		"rearSafetyMarginMillimeters",
		"maximumSpeedMillimetersPerSecond",
		"controlReactionMilliseconds",
		"minimumServiceDecelerationMillimetersPerSecondSquared",
	] as const;
	for (const key of numericKeys)
		if (
			!isUnsignedInteger(
				form[key],
				key !== "version" &&
					key !== "bodyLengthMillimeters" &&
					key !== "bodyWidthMillimeters" &&
					key !== "maximumSpeedMillimetersPerSecond" &&
					key !== "minimumServiceDecelerationMillimetersPerSecondSquared",
			)
		)
			throw new Error(`${key} must be a valid integer.`);
	return {
		id,
		version: Number(form.version),
		bodyLengthMillimeters: Number(form.bodyLengthMillimeters),
		referenceToFrontMillimeters: Number(form.referenceToFrontMillimeters),
		referenceToRearMillimeters: Number(form.referenceToRearMillimeters),
		bodyWidthMillimeters: Number(form.bodyWidthMillimeters),
		lateralSafetyMarginMillimeters: Number(form.lateralSafetyMarginMillimeters),
		frontSafetyMarginMillimeters: Number(form.frontSafetyMarginMillimeters),
		rearSafetyMarginMillimeters: Number(form.rearSafetyMarginMillimeters),
		maximumSpeedMillimetersPerSecond: Number(form.maximumSpeedMillimetersPerSecond),
		controlReactionMilliseconds: Number(form.controlReactionMilliseconds),
		minimumServiceDecelerationMillimetersPerSecondSquared: Number(
			form.minimumServiceDecelerationMillimetersPerSecondSquared,
		),
	};
}
function isUnsignedInteger(value: string, zeroAllowed: boolean): boolean {
	if (!/^\d+$/.test(value)) return false;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= (zeroAllowed ? 0 : 1) && parsed <= 0xffff_ffff;
}
function tabLabel(tab: OperationalConfigurationEditorTab): string {
	if (tab === "stations") return "STATIONS";
	if (tab === "eq") return "EQ";
	if (tab === "storage") return "OHB / STK";
	if (tab === "vehicle") return "VEHICLE";
	if (tab === "resident") return "RESIDENT HOME";
	return "REVIEW";
}
function trapDialogTabNavigation(event: KeyboardEvent<HTMLElement>): void {
	if (event.key !== "Tab") return;
	const focusable = [
		...event.currentTarget.querySelectorAll<HTMLElement>(
			"button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
		),
	].filter((element) => !element.hidden);
	if (focusable.length === 0) {
		event.preventDefault();
		event.currentTarget.focus();
		return;
	}
	const first = focusable[0] as HTMLElement;
	const last = focusable[focusable.length - 1] as HTMLElement;
	const active = document.activeElement;
	if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
		event.preventDefault();
		first.focus();
	}
}
