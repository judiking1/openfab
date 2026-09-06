import { describe, expect, it } from "vitest";
import {
	evaluateGuidedBuildFoundation,
	GUIDED_BUILD_FOUNDATION_MISSIONS,
	type GuidedBuildEvidence,
	guidedBuildHidesExpertSelectionInspectors,
	guidedBuildHidesOrganizationSelectionConstructionBar,
	guidedBuildHidesPracticeHandoffConstructionBar,
	guidedBuildOrganizationArrangementSelectionMode,
	guidedBuildOrganizationPlacementIsHierarchyDuplicate,
	guidedBuildOrganizationPlacementIsSingleCommit,
	guidedBuildPortPlacementRetainsSelection,
	guidedBuildRevealedActivities,
	guidedBuildRevealedEquipmentToolIds,
	guidedBuildRevealedRailConstructionCatalogIds,
	guidedBuildRevealsCheckStatus,
	guidedBuildRevealsConstructionBar,
	guidedBuildRevealsErase,
	guidedBuildRevealsRouteBendControls,
	guidedBuildSelectionCopyPlacementIsSingleCommit,
	guidedBuildShouldAddOrganizationTap,
	guidedBuildSuggestedActionActivity,
	guidedBuildSuggestedActionClearsOrganizationPlacement,
	guidedBuildSuggestedActionClearsPortSelection,
	guidedBuildSuggestedActionSuppressesBayConfiguration,
	guidedBuildTargetActivity,
	guidedBuildTreatsPrimaryTouchAsPan,
	guidedBuildUsesCompactOrganizationPicker,
	guidedBuildVisibleOrganizationSelectionCount,
} from "./GuidedBuildMission";

describe("GuidedBuildMission", () => {
	it("maps each guided action family to the activity that should be highlighted", () => {
		expect(guidedBuildSuggestedActionActivity(null)).toBeNull();
		expect(guidedBuildSuggestedActionActivity("build")).toBe("build");
		expect(guidedBuildSuggestedActionActivity("ohb")).toBe("equip");
		expect(guidedBuildSuggestedActionActivity("eq")).toBe("equip");
		expect(guidedBuildSuggestedActionActivity("stk")).toBe("equip");
		expect(guidedBuildSuggestedActionActivity("inspect")).toBe("inspect");
		expect(guidedBuildSuggestedActionActivity("save-project")).toBe("inspect");
		expect(guidedBuildSuggestedActionActivity("select-connected")).toBe("assemble");
		expect(guidedBuildSuggestedActionActivity("add-bay")).toBe("assemble");
	});

	it("targets the mission owner when no suggested action can lead back from an Expert detour", () => {
		const firstRail = evaluateGuidedBuildFoundation(evidence({ navigationAcknowledged: true }));
		const ports = evaluateGuidedBuildFoundation(
			evidence({
				navigationAcknowledged: true,
				authoredRevision: 1,
				readiness: readyReadiness("closed-loop"),
				railReuse: linkSupportedRailReuse(),
			}),
		);

		expect(firstRail.currentMissionId).toBe("first-rail");
		expect(
			firstRail.missions.find((mission) => mission.status === "current")?.prompt.suggestedAction,
		).toBeNull();
		expect(guidedBuildTargetActivity(firstRail)).toBe("build");
		expect(ports.currentMissionId).toBe("ports");
		expect(guidedBuildTargetActivity(ports)).toBe("equip");
	});

	it("publishes one immutable ordered learning slice", () => {
		expect(GUIDED_BUILD_FOUNDATION_MISSIONS.map((mission) => mission.id)).toEqual([
			"orient",
			"first-rail",
			"process-loop",
			"ports",
			"reuse-loop",
			"bay",
			"bay-bank",
			"interbay",
			"fab-loop",
			"checks",
			"project-save",
			"project-reopen",
		]);
		expect(GUIDED_BUILD_FOUNDATION_MISSIONS.map((mission) => mission.sequence)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
		]);
		expect(GUIDED_BUILD_FOUNDATION_MISSIONS.every(Object.isFrozen)).toBe(true);
		expect(Object.isFrozen(GUIDED_BUILD_FOUNDATION_MISSIONS)).toBe(true);
	});

	it("reserves primary touch pan only for the orientation mission", () => {
		const orient = evaluateGuidedBuildFoundation(evidence());
		const firstRail = evaluateGuidedBuildFoundation(evidence({ navigationAcknowledged: true }));

		expect(guidedBuildTreatsPrimaryTouchAsPan(orient)).toBe(true);
		expect(orient.missions[0]?.prompt.progressCue).toEqual({
			label: "화면 조작",
			value: "TOUCH · MOUSE",
			instruction:
				"터치는 한 손가락 드래그로 이동하고 왼쪽 아래 +/−로 확대·축소하세요. 마우스는 오른쪽/가운데 드래그와 휠을 사용합니다.",
		});
		expect(guidedBuildTreatsPrimaryTouchAsPan(firstRail)).toBe(false);
		expect(Object.isFrozen(orient.missions[0]?.prompt.progressCue)).toBe(true);
	});

	it("starts with orientation and keeps authored missions locked", () => {
		const evaluation = evaluateGuidedBuildFoundation(evidence());

		expect(evaluation.currentMissionId).toBe("orient");
		expect(evaluation.completedMissionCount).toBe(0);
		expect(evaluation.missions.map((mission) => mission.status)).toEqual([
			"current",
			"locked",
			"locked",
			"locked",
			"locked",
			"locked",
			"locked",
			"locked",
			"locked",
			"locked",
			"locked",
			"locked",
		]);
		expect(Object.isFrozen(evaluation)).toBe(true);
		expect(Object.isFrozen(evaluation.missions)).toBe(true);
	});

	it("advances from semantic navigation acknowledgement to authored rail evidence", () => {
		const evaluation = evaluateGuidedBuildFoundation(evidence({ navigationAcknowledged: true }));

		expect(evaluation.currentMissionId).toBe("first-rail");
		expect(evaluation.missions.map((mission) => mission.status)).toEqual([
			"complete",
			"current",
			"locked",
			"locked",
			"locked",
			"locked",
			"locked",
			"locked",
			"locked",
			"locked",
			"locked",
			"locked",
		]);
		expect(evaluation.missions[1]?.prompt.progressCue).toEqual({
			label: "첫 실습",
			value: "가장 긴 직선 0 / 15 m",
			instruction:
				"빈 곳 어디에서든 터치는 누른 채, 마우스는 LMB를 누른 채 가로 또는 세로로 15 m 이상 끌고 놓으세요. 이 직선은 그대로 유지하고, 다음 단계에서 레일 화살표가 향하는 끝부터 Loop를 닫습니다.",
		});
		expect(Object.isFrozen(evaluation.missions[1]?.prompt.progressCue)).toBe(true);
	});

	it("uses an authored edge for First Rail but not for Process Loop", () => {
		const evaluation = evaluateGuidedBuildFoundation(
			evidence({
				navigationAcknowledged: true,
				authoredRevision: 1,
				readiness: {
					status: "blocked",
					ready: false,
					fingerprint: "open-rail",
					issues: [{ code: "OPEN_TERMINAL" }],
					summary: {
						edges: 5,
						closure: "open",
						weakComponents: 1,
						strongComponents: 6,
						openTerminals: 2,
						physicalOpenPaths: 1,
						physicalStrongComponents: 6,
					},
				},
				railReuse: linkSupportedRailReuse(),
			}),
		);

		expect(evaluation.currentMissionId).toBe("process-loop");
		expect(evaluation.completedMissionCount).toBe(2);
		expect(evaluation.missions.map((mission) => mission.status)).toEqual([
			"complete",
			"complete",
			"current",
			"locked",
			"locked",
			"locked",
			"locked",
			"locked",
			"locked",
			"locked",
			"locked",
			"locked",
		]);
		expect(evaluation.missions[2]?.prompt.progressCue).toEqual({
			label: "Loop 상태",
			value: "열린 끝 2개 · 목표 0개",
			instruction:
				"공간이 부족하면 −로 축소하세요. 첫 15칸 이상 직선을 유지한 채 레일 화살표가 향하는 주황색 열린 끝에서 먼저 바깥으로 최소 6칸 뻗고, 나머지 두 변을 이어 시작점에 닫으세요.",
		});
	});

	it("keeps a short practice rail in First Rail until it can support a later Loop Connect", () => {
		const evaluation = evaluateGuidedBuildFoundation(
			evidence({
				navigationAcknowledged: true,
				authoredRevision: 1,
				readiness: openRailReadiness("short-open-rail"),
				railReuse: {
					weakComponentCount: 1,
					networkLinkSupportedComponentCount: 0,
					longestStraightRunMeters: 5,
					repeatedComponentKindCount: 0,
					repeatedComponentCopyCount: 0,
				},
			}),
		);

		expect(evaluation.currentMissionId).toBe("first-rail");
		expect(evaluation.missions[1]?.prompt.progressCue).toEqual({
			label: "다시 그려도 안전해요",
			value: "가장 긴 직선 5 / 15 m · 전체 5 m",
			instruction:
				"꺾인 길이의 합이 아니라 한 방향의 연속 직선이 목표입니다. 주황색 열린 끝을 같은 방향으로 늘리거나, 다른 빈 곳에서 15 m 직선을 새로 그리세요. 연습 초안은 남겨도 되며 START FAB에서 새 프로젝트로 넘어갑니다.",
		});
	});

	it("advances after one supported closed loop even when an earlier open practice draft remains", () => {
		const readiness = openRailReadiness("closed-loop-plus-open-draft");
		const evaluation = evaluateGuidedBuildFoundation(
			evidence({
				navigationAcknowledged: true,
				authoredRevision: 3,
				readiness: {
					...readiness,
					summary: {
						...readiness.summary,
						edges: 48,
						weakComponents: 2,
						strongComponents: 3,
						openTerminals: 2,
						physicalOpenPaths: 1,
						physicalStrongComponents: 2,
					},
				},
				railReuse: {
					weakComponentCount: 2,
					networkLinkSupportedComponentCount: 1,
					longestStraightRunMeters: 17,
					closedStrongComponentCount: 1,
					repeatedComponentKindCount: 0,
					repeatedComponentCopyCount: 0,
				},
			}),
		);

		expect(evaluation.currentMissionId).toBe("ports");
		expect(evaluation.missions[2]?.status).toBe("complete");
	});

	it("advances from exact closed-loop readiness into adaptive port-first guidance", () => {
		const evaluation = evaluateGuidedBuildFoundation(
			evidence({
				navigationAcknowledged: true,
				authoredRevision: 2,
				readiness: {
					status: "ready",
					ready: true,
					fingerprint: "closed-loop",
					issues: [],
					summary: {
						edges: 24,
						closure: "closed",
						weakComponents: 1,
						strongComponents: 1,
						openTerminals: 0,
						physicalOpenPaths: 0,
						physicalStrongComponents: 1,
					},
				},
				railReuse: linkSupportedRailReuse(),
			}),
		);

		expect(evaluation.currentMissionId).toBe("ports");
		expect(evaluation.completedMissionCount).toBe(3);
		expect(evaluation.complete).toBe(false);
		expect(
			evaluation.missions.find((mission) => mission.definition.id === "ports")?.prompt,
		).toMatchObject({
			title: "OHB Port 배치",
			suggestedAction: "ohb",
			progressCue: {
				label: "Port-first 진행",
				value: "OHB 0/1 · EQ 0/2 · STK 0/2",
				instruction:
					"왼쪽의 강조된 OHB · 단일 Port를 선택하세요. 캔버스 포커스에서 방향키로 슬롯을 고르고 Enter로 배치하거나, 점선 고리가 있는 청록 슬롯을 클릭하세요.",
			},
		});
		expect(
			Object.isFrozen(
				evaluation.missions.find((mission) => mission.definition.id === "ports")?.prompt
					.progressCue,
			),
		).toBe(true);
		expect(guidedBuildRevealedActivities(evaluation)).toEqual(["build", "equip"]);
	});

	it("reveals activity owners progressively without serializing or locking editor commands", () => {
		const orient = evaluateGuidedBuildFoundation(evidence());
		const firstRail = evaluateGuidedBuildFoundation(evidence({ navigationAcknowledged: true }));
		const reuseLoop = evaluateGuidedBuildFoundation(
			evidence({
				navigationAcknowledged: true,
				readiness: readyReadiness("guided-reveal"),
				equipment: equipmentEvidence({ OHB: [1, 1], EQ: [1, 2], STK: [1, 2] }),
				railReuse: linkSupportedRailReuse(),
			}),
		);

		expect(guidedBuildRevealedActivities(orient)).toEqual(["build"]);
		expect(guidedBuildRevealedActivities(firstRail)).toEqual(["build"]);
		expect(guidedBuildRevealedActivities(reuseLoop)).toEqual([
			"build",
			"assemble",
			"equip",
			"inspect",
		]);
		expect(Object.isFrozen(guidedBuildRevealedActivities(reuseLoop))).toBe(true);
	});

	it("reveals only mission-owned Build tools while keeping Expert commands outside the policy", () => {
		const orient = evaluateGuidedBuildFoundation(evidence());
		const firstRail = evaluateGuidedBuildFoundation(evidence({ navigationAcknowledged: true }));
		const processLoop = evaluateGuidedBuildFoundation(
			evidence({
				navigationAcknowledged: true,
				readiness: openRailReadiness("guided-tools"),
				railReuse: linkSupportedRailReuse(),
			}),
		);
		const complete = evaluateGuidedBuildFoundation(
			evidence({
				...completedThroughChecks(),
				projectPersistence: reopenedProjectEvidence(),
			}),
		);

		expect(guidedBuildRevealsConstructionBar(orient)).toBe(false);
		expect(guidedBuildRevealedRailConstructionCatalogIds(orient)).toEqual([]);
		expect(guidedBuildRevealsErase(orient)).toBe(false);
		expect(guidedBuildRevealsRouteBendControls(orient)).toBe(false);
		expect(guidedBuildRevealsCheckStatus(orient)).toBe(false);
		expect(guidedBuildRevealedEquipmentToolIds(orient)).toEqual([]);
		expect(guidedBuildRevealsConstructionBar(firstRail)).toBe(false);
		expect(guidedBuildRevealedRailConstructionCatalogIds(firstRail)).toEqual(["route"]);
		expect(guidedBuildRevealsErase(firstRail)).toBe(false);
		expect(guidedBuildRevealsRouteBendControls(firstRail)).toBe(false);
		expect(guidedBuildRevealsCheckStatus(firstRail)).toBe(false);
		expect(guidedBuildRevealedRailConstructionCatalogIds(processLoop)).toEqual(["route"]);
		expect(guidedBuildRevealsConstructionBar(processLoop)).toBe(true);
		expect(guidedBuildRevealsErase(processLoop)).toBe(true);
		expect(guidedBuildRevealsRouteBendControls(processLoop)).toBe(true);
		expect(guidedBuildRevealedRailConstructionCatalogIds(complete)).toEqual([
			"route",
			"u-turn",
			"shift",
			"advanced-switch",
		]);
		expect(guidedBuildRevealsRouteBendControls(complete)).toBe(true);
		expect(guidedBuildRevealsCheckStatus(complete)).toBe(true);
		expect(guidedBuildRevealedEquipmentToolIds(complete)).toEqual(["ohb", "eq", "stk"]);
		expect(Object.isFrozen(guidedBuildRevealedRailConstructionCatalogIds(complete))).toBe(true);
	});

	it("hides unrelated construction chrome only while Guided hierarchy selection owns the next action", () => {
		const selectBay = evaluateGuidedBuildFoundation(evidence(completedThroughTwinBay()));
		const duplicateBay = evaluateGuidedBuildFoundation(
			evidence({
				...completedThroughTwinBay(),
				bayBankGuidance: {
					...bankGuidance(),
					selectedOrganizationCount: 1,
					selectedTwinBayCount: 1,
				},
			}),
		);

		expect(guidedBuildHidesOrganizationSelectionConstructionBar(selectBay)).toBe(true);
		expect(guidedBuildHidesOrganizationSelectionConstructionBar(duplicateBay)).toBe(false);
	});

	it("makes only the mission-owned hierarchy placements single-commit", () => {
		expect(guidedBuildOrganizationPlacementIsSingleCommit("bay", "canvas.primary-click")).toBe(
			true,
		);
		expect(guidedBuildOrganizationPlacementIsSingleCommit("bay-bank", "canvas.primary-click")).toBe(
			true,
		);
		expect(guidedBuildOrganizationPlacementIsSingleCommit("interbay", "canvas.primary-click")).toBe(
			true,
		);
		expect(guidedBuildOrganizationPlacementIsSingleCommit("bay-bank", null)).toBe(false);
		expect(
			guidedBuildOrganizationPlacementIsSingleCommit("reuse-loop", "canvas.primary-click"),
		).toBe(false);
	});

	it("ends Guided Reuse selection-copy placement after one commit", () => {
		expect(
			guidedBuildSelectionCopyPlacementIsSingleCommit(true, "reuse-loop", "selection-copy"),
		).toBe(true);
		expect(
			guidedBuildSelectionCopyPlacementIsSingleCommit(false, "reuse-loop", "selection-copy"),
		).toBe(false);
		expect(guidedBuildSelectionCopyPlacementIsSingleCommit(true, "bay", "selection-copy")).toBe(
			false,
		);
		expect(guidedBuildSelectionCopyPlacementIsSingleCommit(true, "reuse-loop", "recent")).toBe(
			false,
		);
	});

	it("guides OHB then EQ then STK from canonical group membership", () => {
		const base = {
			navigationAcknowledged: true,
			authoredRevision: 4,
			readiness: readyReadiness("closed-loop"),
			railReuse: linkSupportedRailReuse(),
		};
		const beforePorts = evaluateGuidedBuildFoundation(evidence(base));
		const afterOhb = evaluateGuidedBuildFoundation(
			evidence({ ...base, equipment: equipmentEvidence({ OHB: [1, 1] }) }),
		);
		const afterEq = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				equipment: equipmentEvidence({ OHB: [1, 1], EQ: [1, 4] }),
			}),
		);
		const afterPorts = evaluateGuidedBuildFoundation(
			evidence({ ...base, equipment: equipmentEvidence({ OHB: [1, 1], EQ: [1, 4], STK: [1, 2] }) }),
		);

		expect(guidedBuildRevealedEquipmentToolIds(beforePorts)).toEqual(["ohb"]);
		expect(
			afterOhb.missions.find((mission) => mission.definition.id === "ports")?.prompt
				.suggestedAction,
		).toBe("eq");
		expect(
			afterOhb.missions.find((mission) => mission.definition.id === "ports")?.prompt.progressCue,
		).toEqual({
			label: "Port-first 진행",
			value: "OHB 1/1 · EQ 0/2 · STK 0/2",
			instruction:
				"강조된 EQ · Port를 선택하세요. 청록색 1 시작과 2 끝을 차례로 클릭하거나 드래그하세요. 키보드는 시작과 끝에서 Enter를 사용합니다.",
		});
		expect(guidedBuildRevealedEquipmentToolIds(afterOhb)).toEqual(["eq"]);
		expect(
			afterEq.missions.find((mission) => mission.definition.id === "ports")?.prompt.suggestedAction,
		).toBe("stk");
		expect(
			afterEq.missions.find((mission) => mission.definition.id === "ports")?.prompt.progressCue,
		).toEqual({
			label: "Port-first 진행",
			value: "OHB 1/1 · EQ 2/2 · STK 0/2",
			instruction:
				"왼쪽의 강조된 STK · 입출고 Port를 선택하세요. 캔버스에서 방향키와 Enter로 추천 슬롯 두 개를 고르거나, 황금 마름모 슬롯 두 개를 클릭한 뒤 STK 생성을 누르세요.",
		});
		expect(guidedBuildRevealedEquipmentToolIds(afterEq)).toEqual(["stk"]);
		expect(afterPorts.complete).toBe(false);
		expect(afterPorts.currentMissionId).toBe("reuse-loop");
		expect(guidedBuildRevealedEquipmentToolIds(afterPorts)).toEqual(["ohb", "eq", "stk"]);
	});

	it("requires both Guided STK Ports to belong to one canonical group", () => {
		const base = {
			navigationAcknowledged: true,
			authoredRevision: 4,
			readiness: readyReadiness("closed-loop"),
			railReuse: linkSupportedRailReuse(),
			equipment: {
				OHB: { groupCount: 1, portCount: 1, largestGroupPortCount: 1 },
				EQ: { groupCount: 1, portCount: 2, largestGroupPortCount: 2 },
				STK: { groupCount: 2, portCount: 2, largestGroupPortCount: 1 },
			},
		};
		const splitStk = evaluateGuidedBuildFoundation(evidence(base));
		const completeStk = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				equipment: {
					...base.equipment,
					STK: { groupCount: 1, portCount: 2, largestGroupPortCount: 2 },
				},
			}),
		);

		expect(splitStk.currentMissionId).toBe("ports");
		expect(
			splitStk.missions.find((mission) => mission.definition.id === "ports")?.prompt,
		).toMatchObject({
			suggestedAction: "stk",
			progressCue: { value: "OHB 1/1 · EQ 2/2 · STK 1/2" },
		});
		expect(completeStk.currentMissionId).toBe("reuse-loop");
	});

	it("clears a stale Port inspector only for Guided Port and Reuse Loop handoffs", () => {
		expect(guidedBuildSuggestedActionClearsPortSelection("ohb", "ports")).toBe(true);
		expect(guidedBuildSuggestedActionClearsPortSelection("eq", "ports")).toBe(true);
		expect(guidedBuildSuggestedActionClearsPortSelection("stk", "ports")).toBe(true);
		expect(guidedBuildSuggestedActionClearsPortSelection("inspect", "reuse-loop")).toBe(true);
		expect(guidedBuildSuggestedActionClearsPortSelection("build", "first-rail")).toBe(false);
		expect(guidedBuildSuggestedActionClearsPortSelection("inspect", "ports")).toBe(false);
		expect(guidedBuildSuggestedActionClearsPortSelection("select-connected", "reuse-loop")).toBe(
			false,
		);
		expect(guidedBuildSuggestedActionClearsPortSelection("copy-selection", "reuse-loop")).toBe(
			false,
		);
		expect(guidedBuildSuggestedActionClearsPortSelection("add-bay", "bay")).toBe(false);
	});

	it("does not reopen the Expert Port inspector after a Guided Port placement advances", () => {
		expect(guidedBuildPortPlacementRetainsSelection(true, "ports", "eq", "eq")).toBe(false);
		expect(guidedBuildPortPlacementRetainsSelection(true, "ports", "stk", "stk")).toBe(false);
		expect(guidedBuildPortPlacementRetainsSelection(false, "ports", "eq", "eq")).toBe(true);
		expect(guidedBuildPortPlacementRetainsSelection(true, "ports", "stk", "eq")).toBe(true);
		expect(guidedBuildPortPlacementRetainsSelection(true, "reuse-loop", "inspect", "stk")).toBe(
			true,
		);
	});

	it("hides Expert selection inspectors only while Guided Reuse owns the next action", () => {
		expect(guidedBuildHidesExpertSelectionInspectors(true, "reuse-loop")).toBe(true);
		expect(guidedBuildHidesExpertSelectionInspectors(false, "reuse-loop")).toBe(false);
		expect(guidedBuildHidesExpertSelectionInspectors(true, "ports")).toBe(false);
		expect(guidedBuildHidesExpertSelectionInspectors(true, null)).toBe(false);
	});

	it("keeps the organization browser compact throughout Guided hierarchy missions", () => {
		expect(guidedBuildUsesCompactOrganizationPicker(true, "bay-bank")).toBe(true);
		expect(guidedBuildUsesCompactOrganizationPicker(true, "interbay")).toBe(true);
		expect(guidedBuildUsesCompactOrganizationPicker(true, "fab-loop")).toBe(true);
		expect(guidedBuildUsesCompactOrganizationPicker(true, "bay")).toBe(false);
		expect(guidedBuildUsesCompactOrganizationPicker(false, "bay-bank")).toBe(false);
	});

	it("counts only rows visible in the Guided hierarchy picker", () => {
		expect(guidedBuildVisibleOrganizationSelectionCount(true, [11, 12], [21])).toBe(0);
		expect(guidedBuildVisibleOrganizationSelectionCount(true, [11, 12, 21], [21])).toBe(1);
		expect(guidedBuildVisibleOrganizationSelectionCount(true, [21, 22], [21, 22])).toBe(2);
		expect(guidedBuildVisibleOrganizationSelectionCount(false, [11, 12], [21])).toBeNull();
	});

	it("suppresses the Expert Bay configurator only for the Guided default Twin Bay action", () => {
		expect(guidedBuildSuggestedActionSuppressesBayConfiguration("add-bay", "bay")).toBe(true);
		expect(guidedBuildSuggestedActionSuppressesBayConfiguration("add-bay", "bay-bank")).toBe(false);
		expect(guidedBuildSuggestedActionSuppressesBayConfiguration("duplicate-bay", "bay")).toBe(
			false,
		);
	});

	it("distinguishes hierarchy duplication from an earlier assembly-pattern multi-place session", () => {
		expect(guidedBuildOrganizationPlacementIsHierarchyDuplicate("selection-copy")).toBe(true);
		expect(guidedBuildOrganizationPlacementIsHierarchyDuplicate("assembly-pattern")).toBe(false);
		expect(guidedBuildOrganizationPlacementIsHierarchyDuplicate("recent")).toBe(false);
		expect(guidedBuildOrganizationPlacementIsHierarchyDuplicate(null)).toBe(false);
	});

	it("ends repeated hierarchy placement before opening a Guided organization picker", () => {
		expect(guidedBuildSuggestedActionClearsOrganizationPlacement("browse-bays")).toBe(true);
		expect(guidedBuildSuggestedActionClearsOrganizationPlacement("browse-banks")).toBe(true);
		expect(guidedBuildSuggestedActionClearsOrganizationPlacement("duplicate-bay")).toBe(false);
		expect(guidedBuildSuggestedActionClearsOrganizationPlacement("add-bay")).toBe(false);
	});

	it("moves Guided Bay and Bank hierarchies with their effective descendants", () => {
		expect(guidedBuildOrganizationArrangementSelectionMode("arrange-bays")).toBe("EFFECTIVE");
		expect(guidedBuildOrganizationArrangementSelectionMode("arrange-banks")).toBe("EFFECTIVE");
		expect(guidedBuildOrganizationArrangementSelectionMode("connect-bays")).toBeNull();
		expect(guidedBuildOrganizationArrangementSelectionMode("browse-bays")).toBeNull();
	});

	it("changes reuse guidance from selection to copy to ordinary placement", () => {
		const base = {
			navigationAcknowledged: true,
			authoredRevision: 5,
			readiness: readyReadiness("single-loop"),
			equipment: equipmentEvidence({ OHB: [1, 1], EQ: [1, 2], STK: [1, 2] }),
		};
		const select = evaluateGuidedBuildFoundation(evidence(base));
		const copy = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				reuseGuidance: {
					selectionAnchorReady: false,
					reusableSelectionReady: true,
					placementActive: false,
				},
			}),
		);
		const selectConnected = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				reuseGuidance: {
					selectionAnchorReady: true,
					reusableSelectionReady: false,
					placementActive: false,
				},
			}),
		);
		const place = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				reuseGuidance: {
					selectionAnchorReady: false,
					reusableSelectionReady: true,
					placementActive: true,
				},
			}),
		);

		expect(
			select.missions.find((mission) => mission.definition.id === "reuse-loop")?.prompt,
		).toMatchObject({
			title: "Port 포함 Loop 선택",
			objective: "원본 Loop의 레일이나 OHB·EQ·STK 하나를 먼저 탭하세요.",
			rationale:
				"이 미션은 Port까지 보존하는 닫힌 Loop 전체 복제를 연습합니다. 일반 편집에서는 드래그 상자에 닿은 일부 레일 모듈도 닫히지 않아도 그대로 복제할 수 있습니다.",
			primaryCommandId: "selection.inspect-target",
			suggestedAction: "inspect",
			suggestedActionLabel: "INSPECT · Port 포함 Loop 탭",
		});
		expect(
			selectConnected.missions.find((mission) => mission.definition.id === "reuse-loop")?.prompt,
		).toMatchObject({
			title: "Port 포함 Loop 전체 선택",
			objective: "현재 선택이 속한 Loop의 레일과 OHB·EQ·STK 전체를 선택하세요.",
			primaryCommandId: "selection.connected",
			suggestedAction: "select-connected",
			suggestedActionLabel: "SELECT · Port 포함 Loop 전체",
		});
		expect(
			copy.missions.find((mission) => mission.definition.id === "reuse-loop")?.prompt,
		).toMatchObject({
			title: "Port 포함 Loop 복제",
			objective: "선택한 레일과 OHB·EQ·STK를 함께 복사해 1회 배치 미리보기를 시작하세요.",
			primaryCommandId: "selection.copy",
			suggestedAction: "copy-selection",
			suggestedActionLabel: "COPY · Port 포함 Loop 복제",
		});
		expect(
			place.missions.find((mission) => mission.definition.id === "reuse-loop")?.prompt,
		).toMatchObject({
			title: "Port 포함 Loop 배치",
			objective:
				"공간이 부족하면 −로 축소한 뒤, 기존 Loop와 겹치지 않는 정렬된 위치에 레일과 OHB·EQ·STK 복제 미리보기를 한 번 배치하세요.",
			primaryCommandId: "canvas.primary-click",
			suggestedAction: null,
		});
	});

	it("requires exact repeated authored component structure, not merely two closed systems", () => {
		const base = {
			navigationAcknowledged: true,
			authoredRevision: 6,
			readiness: duplicatedReadiness("two-loops"),
			equipment: equipmentEvidence({ OHB: [1, 1], EQ: [1, 2], STK: [1, 2] }),
		};
		const different = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				railReuse: {
					weakComponentCount: 2,
					networkLinkSupportedComponentCount: 2,
					repeatedComponentKindCount: 0,
					repeatedComponentCopyCount: 0,
				},
			}),
		);
		const railOnlyCopy = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				railReuse: {
					weakComponentCount: 2,
					networkLinkSupportedComponentCount: 2,
					repeatedComponentKindCount: 1,
					repeatedComponentCopyCount: 2,
				},
			}),
		);
		const repeated = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				equipment: equipmentEvidence({ OHB: [2, 2], EQ: [2, 4], STK: [2, 4] }),
				railReuse: {
					weakComponentCount: 2,
					networkLinkSupportedComponentCount: 2,
					repeatedComponentKindCount: 1,
					repeatedComponentCopyCount: 2,
				},
			}),
		);

		expect(different.currentMissionId).toBe("reuse-loop");
		expect(railOnlyCopy.currentMissionId).toBe("reuse-loop");
		expect(
			railOnlyCopy.missions.find((mission) => mission.definition.id === "reuse-loop")?.prompt,
		).toMatchObject({
			title: "Port 포함 Loop 선택",
			primaryCommandId: "selection.inspect-target",
		});
		expect(repeated.complete).toBe(false);
		expect(repeated.currentMissionId).toBe("bay");
	});

	it("hands practice off to a clean project before coaching the canonical Twin Bay", () => {
		const base = {
			navigationAcknowledged: true,
			authoredRevision: 8,
			readiness: duplicatedReadiness("reused-loop-and-bay"),
			equipment: equipmentEvidence({ OHB: [2, 2], EQ: [2, 4], STK: [2, 4] }),
			railReuse: {
				weakComponentCount: 2,
				networkLinkSupportedComponentCount: 2,
				repeatedComponentKindCount: 1,
				repeatedComponentCopyCount: 2,
			},
		};
		const choose = evaluateGuidedBuildFoundation(evidence(base));
		const graduatedBase = { ...base, practiceGraduated: true };
		const start = evaluateGuidedBuildFoundation(evidence(graduatedBase));
		const place = evaluateGuidedBuildFoundation(
			evidence({ ...graduatedBase, bayGuidance: { placementActive: true } }),
		);
		const single = evaluateGuidedBuildFoundation(
			evidence({
				...graduatedBase,
				bay: {
					semanticBayCount: 1,
					twinProductionBayCount: 0,
					directProcessLoopCount: 1,
				},
			}),
		);
		const twin = evaluateGuidedBuildFoundation(
			evidence({
				...graduatedBase,
				bay: {
					semanticBayCount: 1,
					twinProductionBayCount: 1,
					directProcessLoopCount: 2,
				},
			}),
		);

		expect(choose.currentMissionId).toBe("bay");
		expect(
			choose.missions.find((mission) => mission.definition.id === "bay")?.prompt,
		).toMatchObject({
			title: "연습을 마치고 FAB 시작",
			primaryCommandId: null,
			suggestedAction: "graduate-practice",
			suggestedActionLabel: "START FAB · 새 프로젝트",
		});
		expect(start.missions.find((mission) => mission.definition.id === "bay")?.prompt).toMatchObject(
			{
				title: "기본 Twin Bay 시작",
				objective:
					"기본 Twin Bay 배치를 바로 시작하세요. 연습 Loop를 박스로 묶지 않고 Shell과 Gateway를 함께 만듭니다.",
				primaryCommandId: null,
				suggestedAction: "add-bay",
				suggestedActionLabel: "ASSEMBLE · 기본 TWIN BAY",
			},
		);
		expect(place.missions.find((mission) => mission.definition.id === "bay")?.prompt).toMatchObject(
			{
				title: "기본 Twin Bay 배치",
				objective:
					"청록색 Twin Bay 미리보기의 ‘여기를 탭’ 표식을 눌러 현재 위치에 배치하세요. 표식이 보이지 않으면 −로 한 번 축소하세요.",
				primaryCommandId: "canvas.primary-click",
			},
		);
		expect(single.currentMissionId).toBe("bay");
		expect(twin.complete).toBe(false);
		expect(twin.currentMissionId).toBe("bay-bank");
		expect(guidedBuildHidesPracticeHandoffConstructionBar(choose)).toBe(true);
		expect(guidedBuildHidesPracticeHandoffConstructionBar(start)).toBe(false);
	});

	it("guides canonical Bay duplication, alignment, Connector selection, and Bank apply", () => {
		const base = completedThroughTwinBay();
		const selectOne = evaluateGuidedBuildFoundation(evidence(base));
		const duplicate = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				bayBankGuidance: bankGuidance({ selectedOrganizationCount: 1, selectedTwinBayCount: 1 }),
			}),
		);
		const place = evaluateGuidedBuildFoundation(
			evidence({ ...base, bayBankGuidance: bankGuidance({ placementActive: true }) }),
		);
		const twoOffset = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				bay: { semanticBayCount: 2, twinProductionBayCount: 2, directProcessLoopCount: 4 },
				bayBank: bankEvidence({ twinProductionBayCount: 2, detachedTwinBayCount: 2 }),
				bayBankGuidance: bankGuidance({
					selectedOrganizationCount: 2,
					selectedTwinBayCount: 2,
				}),
			}),
		);
		const arranging = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				bay: { semanticBayCount: 2, twinProductionBayCount: 2, directProcessLoopCount: 4 },
				bayBank: bankEvidence({ twinProductionBayCount: 2, detachedTwinBayCount: 2 }),
				bayBankGuidance: bankGuidance({
					selectedOrganizationCount: 2,
					selectedTwinBayCount: 2,
					arrangementPhase: "certified",
				}),
			}),
		);
		const connect = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				bay: { semanticBayCount: 2, twinProductionBayCount: 2, directProcessLoopCount: 4 },
				bayBank: bankEvidence({
					twinProductionBayCount: 2,
					detachedTwinBayCount: 2,
					alignedDetachedTwinBayPairCount: 1,
				}),
				bayBankGuidance: bankGuidance({
					selectedOrganizationCount: 2,
					selectedTwinBayCount: 2,
					selectedTwinBayPairAligned: true,
				}),
			}),
		);
		const apply = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				bay: { semanticBayCount: 2, twinProductionBayCount: 2, directProcessLoopCount: 4 },
				bayBank: bankEvidence({ twinProductionBayCount: 2, detachedTwinBayCount: 2 }),
				bayBankGuidance: bankGuidance({
					selectedOrganizationCount: 2,
					selectedTwinBayCount: 2,
					connectorPhase: "ready",
				}),
			}),
		);
		const complete = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				bay: { semanticBayCount: 2, twinProductionBayCount: 2, directProcessLoopCount: 4 },
				bayBank: bankEvidence({
					twinProductionBayCount: 2,
					semanticBayBankCount: 1,
					railBearingTwinBayBankCount: 1,
					bankedTwinBayCount: 2,
				}),
			}),
		);

		expect(selectOne.currentMissionId).toBe("bay-bank");
		expect(
			selectOne.missions.find((mission) => mission.definition.id === "bay-bank")?.prompt,
		).toMatchObject({
			title: "복제할 Twin Bay 선택",
			suggestedAction: "browse-bays",
			organizationSelectionTargetCount: 1,
		});
		expect(
			duplicate.missions.find((mission) => mission.definition.id === "bay-bank")?.prompt,
		).toMatchObject({
			title: "Twin Bay 전체 계층 복제",
			suggestedAction: "duplicate-bay",
		});
		expect(
			place.missions.find((mission) => mission.definition.id === "bay-bank")?.prompt,
		).toMatchObject({
			title: "복제 Twin Bay 배치",
			objective:
				"원본 옆 청록색 복제 미리보기의 ‘여기를 탭’ 표식을 눌러 현재 위치에 배치하세요. 직접 옮기면 가까운 X/Z 중심축에 스냅됩니다.",
			primaryCommandId: "canvas.primary-click",
		});
		expect(
			twoOffset.missions.find((mission) => mission.definition.id === "bay-bank")?.prompt,
		).toMatchObject({
			title: "Twin Bay 중심 정렬",
			primaryCommandId: "arrangement.start",
		});
		const pairPrompt = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				bay: { semanticBayCount: 2, twinProductionBayCount: 2, directProcessLoopCount: 4 },
				bayBank: bankEvidence({ twinProductionBayCount: 2, detachedTwinBayCount: 2 }),
				bayBankGuidance: bankGuidance({
					organizationBrowserOpen: true,
					selectedOrganizationCount: 1,
					selectedTwinBayCount: 1,
				}),
			}),
		).missions.find((mission) => mission.definition.id === "bay-bank")?.prompt;
		expect(pairPrompt).toMatchObject({
			title: "Twin Bay 두 개 선택",
			objective:
				"원본 Twin Bay는 이미 선택되어 있습니다(✓). 체크가 없는 복제 Twin Bay 하나만 탭해 2 / 2로 만드세요.",
			organizationSelectionTargetCount: 2,
		});
		expect(guidedBuildShouldAddOrganizationTap(pairPrompt ?? null, [11], 12)).toBe(true);
		expect(guidedBuildShouldAddOrganizationTap(pairPrompt ?? null, [11], 11)).toBe(false);
		expect(guidedBuildShouldAddOrganizationTap(pairPrompt ?? null, [11, 12], 13)).toBe(false);
		expect(
			guidedBuildShouldAddOrganizationTap(selectOne.missions[6]?.prompt ?? null, [11], 12),
		).toBe(false);
		expect(
			arranging.missions.find((mission) => mission.definition.id === "bay-bank")?.prompt
				.primaryCommandId,
		).toBe("command.apply");
		expect(
			connect.missions.find((mission) => mission.definition.id === "bay-bank")?.prompt,
		).toMatchObject({
			title: "두 Twin Bay 연결",
			objective:
				"현재 두 Twin Bay가 같은 중심축이므로 추가 ARRANGE 없이 아래 CONNECT BAYS를 눌러 하나의 Bay Bank를 만들 연결 경로를 검토하세요.",
			primaryCommandId: "assembly-connector.start",
		});
		expect(
			apply.missions.find((mission) => mission.definition.id === "bay-bank")?.prompt,
		).toMatchObject({
			title: "Bay Bank 만들기",
			presentation: "connector",
			primaryCommandId: "command.apply",
		});
		expect(complete.complete).toBe(false);
		expect(complete.currentMissionId).toBe("interbay");
	});

	it("guides Bank duplication, alignment, typed Interbay selection, and Fab apply", () => {
		const base = completedThroughBayBank();
		const select = evaluateGuidedBuildFoundation(evidence(base));
		const duplicate = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				interbayGuidance: interbayGuidance({
					selectedOrganizationCount: 1,
					selectedBayBankCount: 1,
				}),
			}),
		);
		const place = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				interbayGuidance: interbayGuidance({ placementActive: true }),
			}),
		);
		const arrange = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				interbay: interbayEvidence({ semanticBayBankCount: 2, detachedBayBankCount: 2 }),
				interbayGuidance: interbayGuidance({
					selectedOrganizationCount: 2,
					selectedBayBankCount: 2,
				}),
			}),
		);
		const pairPrompt = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				interbay: interbayEvidence({ semanticBayBankCount: 2, detachedBayBankCount: 2 }),
				interbayGuidance: interbayGuidance({
					organizationBrowserOpen: true,
					selectedOrganizationCount: 1,
					selectedBayBankCount: 1,
				}),
			}),
		).missions.find((mission) => mission.definition.id === "interbay")?.prompt;
		const connect = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				interbay: interbayEvidence({ semanticBayBankCount: 2, detachedBayBankCount: 2 }),
				interbayGuidance: interbayGuidance({
					selectedOrganizationCount: 2,
					selectedBayBankCount: 2,
					selectedBayBankPairAligned: true,
				}),
			}),
		);
		const apply = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				interbay: interbayEvidence({ semanticBayBankCount: 2, detachedBayBankCount: 2 }),
				interbayGuidance: interbayGuidance({
					selectedOrganizationCount: 2,
					selectedBayBankCount: 2,
					connectorPhase: "ready",
				}),
			}),
		);
		const complete = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				interbay: interbayEvidence({
					semanticBayBankCount: 2,
					semanticFabCount: 1,
					interbayFabCount: 1,
					fabBankCount: 2,
				}),
			}),
		);

		expect(select.currentMissionId).toBe("interbay");
		expect(
			select.missions.find((mission) => mission.definition.id === "interbay")?.prompt,
		).toMatchObject({
			title: "복제할 Bay Bank 선택",
			suggestedAction: "browse-banks",
			organizationSelectionTargetCount: 1,
		});
		expect(
			duplicate.missions.find((mission) => mission.definition.id === "interbay")?.prompt,
		).toMatchObject({
			title: "Bay Bank 전체 계층 복제",
			suggestedAction: "duplicate-bank",
		});
		expect(
			place.missions.find((mission) => mission.definition.id === "interbay")?.prompt,
		).toMatchObject({
			title: "복제 Bay Bank 배치",
			objective:
				"원본 옆 청록색 복제 Bay Bank 미리보기의 ‘여기를 탭’ 표식을 눌러 현재 위치에 배치하세요. 직접 옮기면 가까운 X/Z 중심축에 스냅됩니다.",
			primaryCommandId: "canvas.primary-click",
		});
		expect(pairPrompt).toMatchObject({
			title: "Bay Bank 두 개 선택",
			objective:
				"원본 Bay Bank는 이미 선택되어 있습니다(✓). 체크가 없는 복제 Bay Bank 하나만 탭해 2 / 2로 만드세요.",
			organizationSelectionTargetCount: 2,
		});
		expect(
			arrange.missions.find((mission) => mission.definition.id === "interbay")?.prompt,
		).toMatchObject({
			title: "Bay Bank 중심 정렬",
			suggestedAction: "arrange-banks",
		});
		expect(
			connect.missions.find((mission) => mission.definition.id === "interbay")?.prompt,
		).toMatchObject({
			title: "두 Bay Bank 연결",
			objective:
				"현재 두 Bay Bank가 같은 중심축이므로 추가 ARRANGE 없이 아래 CONNECT BANKS를 눌러 하나의 Fab을 만들 Interbay 경로를 검토하세요.",
			suggestedAction: "connect-banks",
		});
		expect(
			apply.missions.find((mission) => mission.definition.id === "interbay")?.prompt,
		).toMatchObject({
			title: "Fab 만들기",
			presentation: "connector",
			primaryCommandId: "command.apply",
		});
		expect(complete.complete).toBe(false);
		expect(complete.currentMissionId).toBe("fab-loop");
	});

	it("routes rejected Arrangement recovery to the existing Cancel owner", () => {
		const twinBase = completedThroughTwinBay();
		const bankBase = completedThroughBayBank();
		const twinRejected = evaluateGuidedBuildFoundation(
			evidence({
				...twinBase,
				bay: { semanticBayCount: 2, twinProductionBayCount: 2, directProcessLoopCount: 4 },
				bayBank: bankEvidence({ twinProductionBayCount: 2, detachedTwinBayCount: 2 }),
				bayBankGuidance: bankGuidance({
					selectedOrganizationCount: 2,
					selectedTwinBayCount: 2,
					arrangementPhase: "rejected",
				}),
			}),
		);
		const bankRejected = evaluateGuidedBuildFoundation(
			evidence({
				...bankBase,
				interbay: interbayEvidence({ semanticBayBankCount: 2, detachedBayBankCount: 2 }),
				interbayGuidance: interbayGuidance({
					selectedOrganizationCount: 2,
					selectedBayBankCount: 2,
					arrangementPhase: "rejected",
				}),
			}),
		);

		expect(
			twinRejected.missions.find((mission) => mission.definition.id === "bay-bank")?.prompt,
		).toMatchObject({
			title: "현재 정렬 적용 불가",
			primaryCommandId: "command.cancel",
		});
		expect(
			bankRejected.missions.find((mission) => mission.definition.id === "interbay")?.prompt,
		).toMatchObject({
			title: "현재 정렬 적용 불가",
			primaryCommandId: "command.cancel",
		});
	});

	it("guides a second same-Fab route and completes only from bidirectional resilience", () => {
		const base = completedThroughInterbay();
		const select = evaluateGuidedBuildFoundation(evidence(base));
		const start = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				fabLoopGuidance: fabLoopGuidance({
					selectedOrganizationCount: 2,
					selectedBayBankCount: 2,
				}),
			}),
		);
		const apply = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				fabLoopGuidance: fabLoopGuidance({
					selectedOrganizationCount: 2,
					selectedBayBankCount: 2,
					connectorPhase: "ready",
				}),
			}),
		);
		const complete = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				fabLoop: fabLoopEvidence({ resilientFabLoopCount: 1, resilientBankPairCount: 1 }),
			}),
		);

		expect(select.currentMissionId).toBe("fab-loop");
		expect(
			select.missions.find((mission) => mission.definition.id === "fab-loop")?.prompt,
		).toMatchObject({
			title: "같은 Fab의 두 Bay Bank 선택",
			suggestedAction: "browse-banks",
			organizationSelectionTargetCount: 2,
		});
		expect(
			start.missions.find((mission) => mission.definition.id === "fab-loop")?.prompt,
		).toMatchObject({
			title: "Fab 외곽 순환 추가",
			suggestedAction: "add-fab-loop",
		});
		expect(
			apply.missions.find((mission) => mission.definition.id === "fab-loop")?.prompt,
		).toMatchObject({
			title: "외곽 순환 적용",
			presentation: "connector",
			primaryCommandId: "command.apply",
		});
		expect(complete.complete).toBe(false);
		expect(complete.currentMissionId).toBe("checks");
	});

	it("opens exact whole-project Checks and requires current-fingerprint acknowledgement", () => {
		const base = completedThroughFabLoop();
		const open = evaluateGuidedBuildFoundation(evidence(base));
		const pending = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				checksGuidance: checksGuidance({ navigatorOpen: true, inspectionPending: true }),
			}),
		);
		const ready = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				checks: checksEvidence({ available: true, ready: true, fingerprint: "checks-current" }),
			}),
		);
		const review = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				checks: checksEvidence({ available: true, ready: true, fingerprint: "checks-current" }),
				checksGuidance: checksGuidance({ navigatorOpen: true }),
			}),
		);
		const staleAcknowledgement = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				checks: checksEvidence({ available: true, ready: true, fingerprint: "checks-current" }),
				checksGuidance: checksGuidance({
					navigatorOpen: true,
					acknowledgedFingerprint: "checks-previous",
				}),
			}),
		);
		const complete = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				checks: checksEvidence({ available: true, ready: true, fingerprint: "checks-current" }),
				checksGuidance: checksGuidance({
					navigatorOpen: true,
					acknowledgedFingerprint: "checks-current",
				}),
			}),
		);

		expect(open.currentMissionId).toBe("checks");
		expect(
			open.missions.find((mission) => mission.definition.id === "checks")?.prompt,
		).toMatchObject({
			title: "CHECKS 열기",
			suggestedAction: "open-checks",
		});
		expect(
			pending.missions.find((mission) => mission.definition.id === "checks")?.prompt,
		).toMatchObject({
			title: "전체 프로젝트 검사 중",
			suggestedAction: null,
		});
		expect(
			ready.missions.find((mission) => mission.definition.id === "checks")?.prompt,
		).toMatchObject({
			title: "검증 결과 검토",
			suggestedAction: "open-checks",
		});
		expect(
			review.missions.find((mission) => mission.definition.id === "checks")?.prompt,
		).toMatchObject({
			title: "현재 검증 결과 확인",
			suggestedAction: "confirm-checks",
		});
		expect(staleAcknowledgement.complete).toBe(false);
		expect(staleAcknowledgement.currentMissionId).toBe("checks");
		expect(complete.complete).toBe(false);
		expect(complete.currentMissionId).toBe("project-save");
	});

	it("hands organization-protected rail findings back to CHECKS-owned repair", () => {
		const prompt = evaluateGuidedBuildFoundation(
			evidence({
				...completedThroughFabLoop(),
				checks: checksEvidence({
					available: true,
					blockingIssueCount: 1,
					followUpIssueCount: 2,
					separateRailNetworkCount: 3,
				}),
				checksGuidance: checksGuidance({ navigatorOpen: true }),
			}),
		).missions.find((mission) => mission.definition.id === "checks")?.prompt;

		expect(prompt).toMatchObject({
			title: "차단 이슈 해결",
			suggestedAction: null,
		});
		expect(prompt?.objective).toContain("Bay·Bank·Fab 안의 레일");
		expect(prompt?.objective).toContain("NEXT EDIT");
	});

	it("uses native save and exact same-project reopen receipts before resuming", () => {
		const base = completedThroughChecks();
		const unsaved = evaluateGuidedBuildFoundation(evidence(base));
		const saving = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				projectPersistence: projectPersistenceEvidence({ operation: "saving" }),
			}),
		);
		const saved = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				projectPersistence: savedProjectEvidence(),
			}),
		);
		const checksumDiverged = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				projectPersistence: savedProjectEvidence({ currentChecksum: "checksum-edited" }),
			}),
		);
		const opening = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				projectPersistence: savedProjectEvidence({
					operation: "opening",
					reopenExpectationProjectId: "project-a",
					reopenExpectationChecksum: "checksum-a",
					reopenExpectationSequence: 1,
				}),
			}),
		);
		const openedBeforeExpectation = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				projectPersistence: savedProjectEvidence({
					reopenExpectationProjectId: "project-a",
					reopenExpectationChecksum: "checksum-a",
					reopenExpectationSequence: 2,
					lastOpenedProjectId: "project-a",
					lastOpenedChecksum: "checksum-a",
					lastOpenedSequence: 1,
				}),
			}),
		);
		const wrongProject = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				projectPersistence: savedProjectEvidence({
					reopenExpectationProjectId: "project-a",
					reopenExpectationChecksum: "checksum-a",
					reopenExpectationSequence: 1,
					lastOpenedProjectId: "project-b",
					lastOpenedChecksum: "checksum-b",
					lastOpenedSequence: 2,
				}),
			}),
		);
		const reopened = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				projectPersistence: reopenedProjectEvidence(),
			}),
		);
		const reopenedBeforeFreshChecks = evaluateGuidedBuildFoundation(
			evidence({
				...completedThroughFabLoop(),
				projectPersistence: reopenedProjectEvidence(),
			}),
		);

		expect(unsaved.currentMissionId).toBe("project-save");
		expect(unsaved.missions.at(-2)?.prompt).toMatchObject({
			title: "OpenFab 프로젝트 저장",
			suggestedAction: "save-project",
			suggestedActionLabel: "전체 프로젝트 저장",
		});
		expect(saving.missions.at(-2)?.prompt).toMatchObject({
			title: "프로젝트 저장 중",
			suggestedAction: null,
		});
		expect(saved.currentMissionId).toBe("project-reopen");
		expect(saved.missions.at(-1)?.prompt).toMatchObject({
			title: "저장한 프로젝트 다시 열기",
			suggestedAction: "open-project",
		});
		expect(checksumDiverged.currentMissionId).toBe("project-save");
		expect(opening.missions.at(-1)?.prompt).toMatchObject({
			title: "저장 파일 검증 중",
			suggestedAction: null,
		});
		expect(openedBeforeExpectation.complete).toBe(false);
		expect(wrongProject.complete).toBe(false);
		expect(wrongProject.missions.at(-1)?.prompt.title).toBe("저장한 프로젝트 다시 선택");
		expect(reopenedBeforeFreshChecks.currentMissionId).toBe("checks");
		expect(
			reopenedBeforeFreshChecks.missions.find((mission) => mission.definition.id === "checks")
				?.prompt,
		).toMatchObject({
			eyebrow: "MISSION 12 · REOPEN · FINAL CHECK",
			title: "다시 연 프로젝트 최종 검사",
			objective:
				"방금 저장한 같은 프로젝트를 다시 열었습니다. 마지막 확인으로 CHECKS를 한 번 실행하세요.",
			suggestedAction: "open-checks",
			suggestedActionLabel: "다시 연 파일 검사",
			progressPresentation: "reopen-final-check",
		});
		expect(reopened.complete).toBe(true);
		expect(reopened.currentMissionId).toBeNull();
	});

	it("does not treat structurally repeated but unsafe closed systems as a completed loop", () => {
		const readiness = duplicatedReadiness("unsafe-copies");
		const evaluation = evaluateGuidedBuildFoundation(
			evidence({
				navigationAcknowledged: true,
				authoredRevision: 7,
				readiness: {
					...readiness,
					issues: [...readiness.issues, { code: "UNSUPPORTED_JUNCTION" }],
				},
				equipment: equipmentEvidence({ OHB: [2, 2], EQ: [2, 4], STK: [2, 4] }),
				railReuse: {
					weakComponentCount: 2,
					networkLinkSupportedComponentCount: 2,
					repeatedComponentKindCount: 1,
					repeatedComponentCopyCount: 2,
				},
				bay: {
					semanticBayCount: 1,
					twinProductionBayCount: 1,
					directProcessLoopCount: 2,
				},
				bayBank: bankEvidence({
					twinProductionBayCount: 2,
					semanticBayBankCount: 1,
					railBearingTwinBayBankCount: 1,
					bankedTwinBayCount: 2,
				}),
				interbay: interbayEvidence({
					semanticBayBankCount: 2,
					semanticFabCount: 1,
					interbayFabCount: 1,
					fabBankCount: 2,
				}),
				fabLoop: fabLoopEvidence({ resilientFabLoopCount: 1, resilientBankPairCount: 1 }),
				checks: checksEvidence({ available: true, ready: true, fingerprint: "closed-checks" }),
				checksGuidance: checksGuidance({ acknowledgedFingerprint: "closed-checks" }),
			}),
		);

		expect(evaluation.currentMissionId).toBe("process-loop");
		expect(evaluation.complete).toBe(false);
	});

	it("reopens the correct mission after ordinary undo evidence", () => {
		const closed = evaluateGuidedBuildFoundation(
			evidence({
				navigationAcknowledged: true,
				authoredRevision: 2,
				readiness: duplicatedReadiness("closed-loop-copy"),
				equipment: equipmentEvidence({ OHB: [2, 2], EQ: [2, 4], STK: [2, 4] }),
				railReuse: {
					weakComponentCount: 2,
					networkLinkSupportedComponentCount: 2,
					repeatedComponentKindCount: 1,
					repeatedComponentCopyCount: 2,
				},
				bay: {
					semanticBayCount: 2,
					twinProductionBayCount: 2,
					directProcessLoopCount: 4,
				},
				bayBank: bankEvidence({
					twinProductionBayCount: 2,
					semanticBayBankCount: 1,
					railBearingTwinBayBankCount: 1,
					bankedTwinBayCount: 2,
				}),
				interbay: interbayEvidence({
					semanticBayBankCount: 2,
					semanticFabCount: 1,
					interbayFabCount: 1,
					fabBankCount: 2,
				}),
				fabLoop: fabLoopEvidence({ resilientFabLoopCount: 1, resilientBankPairCount: 1 }),
				checks: checksEvidence({ available: true, ready: true, fingerprint: "undo-checks" }),
				checksGuidance: checksGuidance({ acknowledgedFingerprint: "undo-checks" }),
				projectPersistence: reopenedProjectEvidence(),
			}),
		);
		const undoneToRail = evaluateGuidedBuildFoundation(
			evidence({
				navigationAcknowledged: true,
				authoredRevision: 3,
				readiness: openRailReadiness("undo-open"),
				equipment: equipmentEvidence({ OHB: [1, 1], EQ: [1, 2], STK: [1, 2] }),
				railReuse: linkSupportedRailReuse(),
			}),
		);
		const undoneToEmpty = evaluateGuidedBuildFoundation(
			evidence({
				navigationAcknowledged: true,
				authoredRevision: 4,
				readiness: emptyReadiness("undo-empty"),
				equipment: equipmentEvidence({ OHB: [1, 1], EQ: [1, 2], STK: [1, 2] }),
			}),
		);

		expect(closed.complete).toBe(true);
		expect(undoneToRail.currentMissionId).toBe("process-loop");
		expect(undoneToEmpty.currentMissionId).toBe("first-rail");
		expect(new Set([closed.sourceKey, undoneToRail.sourceKey, undoneToEmpty.sourceKey]).size).toBe(
			3,
		);
	});

	it("does not trust a contradictory ready flag without exact loop facts", () => {
		const evaluation = evaluateGuidedBuildFoundation(
			evidence({
				navigationAcknowledged: true,
				readiness: {
					...readyReadiness("forged"),
					summary: { ...readyReadiness("forged").summary, edges: 0 },
				},
			}),
		);

		expect(evaluation.currentMissionId).toBe("first-rail");
		expect(evaluation.complete).toBe(false);
	});
});

function linkSupportedRailReuse(
	overrides: Partial<GuidedBuildEvidence["railReuse"]> = {},
): GuidedBuildEvidence["railReuse"] {
	return {
		weakComponentCount: 1,
		networkLinkSupportedComponentCount: 1,
		repeatedComponentKindCount: 0,
		repeatedComponentCopyCount: 0,
		...overrides,
	};
}

function evidence(overrides: Partial<GuidedBuildEvidence> = {}): GuidedBuildEvidence {
	return {
		navigationAcknowledged: false,
		practiceGraduated: false,
		authoredRevision: 0,
		readiness: emptyReadiness("empty"),
		equipment: equipmentEvidence(),
		reuseGuidance: {
			selectionAnchorReady: false,
			reusableSelectionReady: false,
			placementActive: false,
		},
		railReuse: {
			weakComponentCount: 0,
			networkLinkSupportedComponentCount: 0,
			repeatedComponentKindCount: 0,
			repeatedComponentCopyCount: 0,
		},
		bayGuidance: { placementActive: false },
		bay: {
			semanticBayCount: 0,
			twinProductionBayCount: 0,
			directProcessLoopCount: 0,
		},
		bayBankGuidance: bankGuidance(),
		bayBank: bankEvidence(),
		interbayGuidance: interbayGuidance(),
		interbay: interbayEvidence(),
		fabLoopGuidance: fabLoopGuidance(),
		fabLoop: fabLoopEvidence(),
		checks: checksEvidence(),
		checksGuidance: checksGuidance(),
		projectPersistence: projectPersistenceEvidence(),
		...overrides,
	};
}

function completedThroughFabLoop(): Partial<GuidedBuildEvidence> {
	return {
		...completedThroughInterbay(),
		fabLoop: fabLoopEvidence({
			semanticFabCount: 1,
			eligibleFabCount: 1,
			resilientFabLoopCount: 1,
			resilientBankPairCount: 1,
		}),
	};
}

function completedThroughChecks(): Partial<GuidedBuildEvidence> {
	return {
		...completedThroughFabLoop(),
		checks: checksEvidence({ available: true, ready: true, fingerprint: "checks-current" }),
		checksGuidance: checksGuidance({ acknowledgedFingerprint: "checks-current" }),
	};
}

function completedThroughInterbay(): Partial<GuidedBuildEvidence> {
	return {
		...completedThroughBayBank(),
		interbay: interbayEvidence({
			semanticBayBankCount: 2,
			semanticFabCount: 1,
			interbayFabCount: 1,
			fabBankCount: 2,
		}),
		fabLoop: fabLoopEvidence({ semanticFabCount: 1, eligibleFabCount: 1 }),
	};
}

function completedThroughBayBank(): Partial<GuidedBuildEvidence> {
	return {
		...completedThroughTwinBay(),
		bay: { semanticBayCount: 2, twinProductionBayCount: 2, directProcessLoopCount: 4 },
		bayBank: bankEvidence({
			twinProductionBayCount: 2,
			semanticBayBankCount: 1,
			railBearingTwinBayBankCount: 1,
			bankedTwinBayCount: 2,
		}),
		interbay: interbayEvidence({ semanticBayBankCount: 1, detachedBayBankCount: 1 }),
	};
}

function completedThroughTwinBay(): Partial<GuidedBuildEvidence> {
	return {
		navigationAcknowledged: true,
		practiceGraduated: true,
		authoredRevision: 9,
		readiness: duplicatedReadiness("guided-bank"),
		equipment: equipmentEvidence({ OHB: [2, 2], EQ: [2, 4], STK: [2, 4] }),
		railReuse: {
			weakComponentCount: 2,
			networkLinkSupportedComponentCount: 2,
			repeatedComponentKindCount: 1,
			repeatedComponentCopyCount: 2,
		},
		bay: { semanticBayCount: 1, twinProductionBayCount: 1, directProcessLoopCount: 2 },
		bayBank: bankEvidence({ twinProductionBayCount: 1, detachedTwinBayCount: 1 }),
	};
}

function bankGuidance(
	overrides: Partial<GuidedBuildEvidence["bayBankGuidance"]> = {},
): GuidedBuildEvidence["bayBankGuidance"] {
	return {
		placementActive: false,
		organizationBrowserOpen: false,
		selectedOrganizationCount: 0,
		selectedTwinBayCount: 0,
		selectedTwinBayPairAligned: false,
		arrangementPhase: "inactive",
		connectorPhase: "inactive",
		...overrides,
	};
}

function bankEvidence(
	overrides: Partial<GuidedBuildEvidence["bayBank"]> = {},
): GuidedBuildEvidence["bayBank"] {
	return {
		twinProductionBayCount: 0,
		detachedTwinBayCount: 0,
		alignedDetachedTwinBayPairCount: 0,
		semanticBayBankCount: 0,
		railBearingTwinBayBankCount: 0,
		bankedTwinBayCount: 0,
		...overrides,
	};
}

function interbayGuidance(
	overrides: Partial<GuidedBuildEvidence["interbayGuidance"]> = {},
): GuidedBuildEvidence["interbayGuidance"] {
	return {
		placementActive: false,
		organizationBrowserOpen: false,
		selectedOrganizationCount: 0,
		selectedBayBankCount: 0,
		selectedBayBankPairAligned: false,
		arrangementPhase: "inactive",
		connectorPhase: "inactive",
		...overrides,
	};
}

function interbayEvidence(
	overrides: Partial<GuidedBuildEvidence["interbay"]> = {},
): GuidedBuildEvidence["interbay"] {
	return {
		semanticBayBankCount: 0,
		detachedBayBankCount: 0,
		semanticFabCount: 0,
		interbayFabCount: 0,
		fabBankCount: 0,
		...overrides,
	};
}

function fabLoopGuidance(
	overrides: Partial<GuidedBuildEvidence["fabLoopGuidance"]> = {},
): GuidedBuildEvidence["fabLoopGuidance"] {
	return {
		organizationBrowserOpen: false,
		selectedOrganizationCount: 0,
		selectedBayBankCount: 0,
		connectorPhase: "inactive",
		...overrides,
	};
}

function fabLoopEvidence(
	overrides: Partial<GuidedBuildEvidence["fabLoop"]> = {},
): GuidedBuildEvidence["fabLoop"] {
	return {
		semanticFabCount: 0,
		eligibleFabCount: 0,
		resilientFabLoopCount: 0,
		resilientBankPairCount: 0,
		...overrides,
	};
}

function checksEvidence(
	overrides: Partial<GuidedBuildEvidence["checks"]> = {},
): GuidedBuildEvidence["checks"] {
	return {
		available: false,
		ready: false,
		fingerprint: "",
		blockingIssueCount: 0,
		followUpIssueCount: 0,
		separateRailNetworkCount: 0,
		...overrides,
	};
}

function checksGuidance(
	overrides: Partial<GuidedBuildEvidence["checksGuidance"]> = {},
): GuidedBuildEvidence["checksGuidance"] {
	return {
		navigatorOpen: false,
		inspectionPending: false,
		acknowledgedFingerprint: null,
		...overrides,
	};
}

function projectPersistenceEvidence(
	overrides: Partial<GuidedBuildEvidence["projectPersistence"]> = {},
): GuidedBuildEvidence["projectPersistence"] {
	return {
		operation: "idle",
		projectId: "project-a",
		currentChecksum: "checksum-a",
		savedChecksum: "",
		currentOperationalConfigurationFingerprint: "operational-a",
		savedOperationalConfigurationFingerprint: "",
		fileReferenceAvailable: false,
		migrated: false,
		needsSave: true,
		reopenExpectationProjectId: null,
		reopenExpectationChecksum: null,
		reopenExpectationSequence: 0,
		lastOpenedProjectId: null,
		lastOpenedChecksum: null,
		lastOpenedSequence: 0,
		...overrides,
	};
}

function savedProjectEvidence(
	overrides: Partial<GuidedBuildEvidence["projectPersistence"]> = {},
): GuidedBuildEvidence["projectPersistence"] {
	return projectPersistenceEvidence({
		savedChecksum: "checksum-a",
		savedOperationalConfigurationFingerprint: "operational-a",
		fileReferenceAvailable: true,
		needsSave: false,
		...overrides,
	});
}

function reopenedProjectEvidence(): GuidedBuildEvidence["projectPersistence"] {
	return savedProjectEvidence({
		reopenExpectationProjectId: "project-a",
		reopenExpectationChecksum: "checksum-a",
		reopenExpectationSequence: 1,
		lastOpenedProjectId: "project-a",
		lastOpenedChecksum: "checksum-a",
		lastOpenedSequence: 2,
	});
}

function equipmentEvidence(
	overrides: Partial<Record<"OHB" | "EQ" | "STK", readonly [number, number]>> = {},
): GuidedBuildEvidence["equipment"] {
	const kind = (name: "OHB" | "EQ" | "STK") => ({
		groupCount: overrides[name]?.[0] ?? 0,
		portCount: overrides[name]?.[1] ?? 0,
		largestGroupPortCount:
			(overrides[name]?.[0] ?? 0) > 0
				? Math.ceil((overrides[name]?.[1] ?? 0) / (overrides[name]?.[0] ?? 1))
				: 0,
	});
	return { OHB: kind("OHB"), EQ: kind("EQ"), STK: kind("STK") };
}

function emptyReadiness(fingerprint: string): GuidedBuildEvidence["readiness"] {
	return {
		status: "empty",
		ready: false,
		fingerprint,
		issues: [{ code: "EMPTY_PROJECT" }],
		summary: {
			edges: 0,
			closure: "empty",
			weakComponents: 0,
			strongComponents: 0,
			openTerminals: 0,
			physicalOpenPaths: 0,
			physicalStrongComponents: 0,
		},
	};
}

function openRailReadiness(fingerprint: string): GuidedBuildEvidence["readiness"] {
	return {
		status: "blocked",
		ready: false,
		fingerprint,
		issues: [{ code: "OPEN_TERMINAL" }],
		summary: {
			edges: 5,
			closure: "open",
			weakComponents: 1,
			strongComponents: 6,
			openTerminals: 2,
			physicalOpenPaths: 1,
			physicalStrongComponents: 6,
		},
	};
}

function readyReadiness(fingerprint: string): GuidedBuildEvidence["readiness"] {
	return {
		status: "ready",
		ready: true,
		fingerprint,
		issues: [],
		summary: {
			edges: 24,
			closure: "closed",
			weakComponents: 1,
			strongComponents: 1,
			openTerminals: 0,
			physicalOpenPaths: 0,
			physicalStrongComponents: 1,
		},
	};
}

function duplicatedReadiness(fingerprint: string): GuidedBuildEvidence["readiness"] {
	return {
		status: "blocked",
		ready: false,
		fingerprint,
		issues: [
			{ code: "DISCONNECTED_NETWORK" },
			{ code: "MULTIPLE_STRONG_COMPONENTS" },
			{ code: "PHYSICAL_DISCONNECTED" },
		],
		summary: {
			edges: 48,
			closure: "closed",
			weakComponents: 2,
			strongComponents: 2,
			openTerminals: 0,
			physicalOpenPaths: 0,
			physicalStrongComponents: 2,
		},
	};
}
