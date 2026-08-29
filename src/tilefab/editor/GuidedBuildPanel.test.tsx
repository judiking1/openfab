import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { guidedBuildInputHint } from "./GuidedBuildInputHint";
import { evaluateGuidedBuildFoundation, type GuidedBuildEvidence } from "./GuidedBuildMission";
import { GuidedBuildPanel } from "./GuidedBuildPanel";
import { OpenFabStartDialog } from "./OpenFabStartDialog";

describe("OpenFabStartDialog", () => {
	it("offers the three explicit non-mutating start paths", () => {
		const markup = renderToStaticMarkup(
			<OpenFabStartDialog
				onGuidedBuild={() => undefined}
				onVerifiedTemplate={() => undefined}
				onBlankCanvas={() => undefined}
				onClose={() => undefined}
			/>,
		);

		expect(markup).toContain('role="dialog"');
		expect(markup).toContain('aria-modal="true"');
		expect(markup).toContain("GUIDED BUILD");
		expect(markup).toContain("첫 정적 FAB");
		expect(markup).toContain("레일 → Port → Bay/Bank → Fab → 검증·저장");
		expect(markup).toContain("VERIFIED TEMPLATE");
		expect(markup).toContain("BLANK CANVAS");
	});
});

describe("GuidedBuildPanel", () => {
	it("presents one current objective and its registry-owned input hint", () => {
		const markup = panelMarkup(evidence({ navigationAcknowledged: true }));

		expect(markup).toContain('data-current-mission="first-rail"');
		expect(markup).toContain("첫 단방향 레일");
		expect(markup).toContain('value="2"');
		expect(markup).toContain('max="12"');
		expect(markup).toContain('aria-valuetext="2 / 12 · 첫 단방향 레일"');
		expect(markup).not.toContain("MISSION 2 · FIRST RAIL");
		expect(markup).not.toContain('data-testid="guided-build-mission-detail"');
		expect(markup).not.toContain("닫힌 Process Loop: locked");
		expect(markup).toContain("현재 도구 드래그");
		expect(markup).toContain("TOUCH DRAG");
		expect(markup).toContain("LMB DRAG");
		expect(markup).toContain('data-testid="guided-build-progress-cue"');
		expect(markup).toContain("연결 가능한 직선 0 / 1");
		expect(markup).toContain("가로 또는 세로로 15칸 이상");
		expect(markup).not.toContain("모든 Process Loop와 Bay는");
		expect(markup).not.toContain("이동을 익혔어요");
		expect(markup).toContain("이 단계 도움말");
		expect(markup).toContain('aria-expanded="false"');
		expect(markup).not.toContain('data-testid="guided-build-mission-help"');
		expect(markup).not.toContain('data-testid="editor-command-help"');
	});

	it("shows the acknowledgement only for the semantic orientation step", () => {
		const markup = panelMarkup(evidence());

		expect(markup).toContain('data-current-mission="orient"');
		expect(markup).toContain('aria-valuetext="1 / 12 · 캔버스 익히기"');
		expect(markup).toContain("이동을 익혔어요");
		expect(markup).toContain("TOUCH · MOUSE");
		expect(markup).toContain("터치는 한 손가락 드래그로 이동하고");
		expect(markup).toContain("왼쪽 아래 +/−로 확대·축소");
		expect(markup).toContain("RMB / MMB DRAG");
		expect(markup).toContain("WASD / ←↑↓→");
	});

	it("adds device-neutral equivalents without changing the command registry", () => {
		const keyboardHint = {
			inputs: ["⌘ / CTRL", "C"],
			inputJoin: "plus" as const,
			pointer: false,
		};

		expect(
			guidedBuildInputHint("canvas.primary-click", {
				inputs: ["LMB"],
				inputJoin: "plus",
				pointer: true,
			}),
		).toEqual({ inputs: ["TOUCH", "LMB"], inputJoin: "or", pointer: true });
		expect(
			guidedBuildInputHint("organization.select", {
				inputs: ["ENTER / SPACE"],
				inputJoin: "plus",
				pointer: false,
			}),
		).toEqual({ inputs: ["TAP", "ENTER / SPACE"], inputJoin: "or", pointer: true });
		expect(guidedBuildInputHint("selection.copy", keyboardHint)).toBe(keyboardHint);
	});

	it("turns the first authored rail into an explicit live Loop target", () => {
		const markup = panelMarkup(
			evidence({
				navigationAcknowledged: true,
				authoredRevision: 1,
				readiness: {
					status: "blocked",
					ready: false,
					fingerprint: "open-practice-rail",
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

		expect(markup).toContain('data-current-mission="process-loop"');
		expect(markup).toContain("열린 끝 2개 · 목표 0개");
		expect(markup).toContain("공간이 부족하면 −로 축소하세요");
		expect(markup).toContain("첫 15칸 이상 직선을 유지한 채");
		expect(markup).toContain("나머지 세 변을 이어 시작점에 닫으세요");
		expect(markup).not.toContain("작은 닫힌 회로는 Bay가 아니라");
	});

	it("shows a bounded completion state after exact save and reopen", () => {
		const markup = panelMarkup(
			evidence({
				navigationAcknowledged: true,
				authoredRevision: 2,
				readiness: {
					status: "blocked",
					ready: false,
					fingerprint: "reused",
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
				},
				equipment: {
					OHB: { groupCount: 2, portCount: 2 },
					EQ: { groupCount: 2, portCount: 4 },
					STK: { groupCount: 2, portCount: 4 },
				},
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
				bayBank: {
					twinProductionBayCount: 2,
					detachedTwinBayCount: 0,
					alignedDetachedTwinBayPairCount: 0,
					semanticBayBankCount: 1,
					railBearingTwinBayBankCount: 1,
					bankedTwinBayCount: 2,
				},
				interbay: {
					semanticBayBankCount: 2,
					detachedBayBankCount: 0,
					semanticFabCount: 1,
					interbayFabCount: 1,
					fabBankCount: 2,
				},
				fabLoop: {
					semanticFabCount: 1,
					eligibleFabCount: 1,
					resilientFabLoopCount: 1,
					resilientBankPairCount: 1,
				},
				checks: {
					available: true,
					ready: true,
					fingerprint: "completed-checks",
					blockingIssueCount: 0,
					followUpIssueCount: 0,
					separateRailNetworkCount: 1,
				},
				checksGuidance: {
					navigatorOpen: true,
					inspectionPending: false,
					acknowledgedFingerprint: "completed-checks",
					networkLinkRepairAvailable: true,
					networkLinkRepairActive: false,
					networkLinkSourceSelected: false,
				},
				projectPersistence: {
					operation: "idle",
					projectId: "project-a",
					currentChecksum: "checksum-a",
					savedChecksum: "checksum-a",
					currentOperationalConfigurationFingerprint: "operational-a",
					savedOperationalConfigurationFingerprint: "operational-a",
					fileReferenceAvailable: true,
					migrated: false,
					needsSave: false,
					reopenExpectationProjectId: "project-a",
					reopenExpectationChecksum: "checksum-a",
					reopenExpectationSequence: 1,
					lastOpenedProjectId: "project-a",
					lastOpenedChecksum: "checksum-a",
					lastOpenedSequence: 2,
				},
			}),
		);

		expect(markup).toContain('data-current-mission="complete"');
		expect(markup).toContain('aria-valuetext="12 / 12 · 완료"');
		expect(markup).toContain("첫 정적 FAB 작업 흐름 완료");
		expect(markup).toContain("편집 계속하기");
	});

	it("offers the ordinary Equip tool for the next missing canonical port kind", () => {
		const portEvidence = evidence({
			navigationAcknowledged: true,
			authoredRevision: 4,
			readiness: {
				status: "ready",
				ready: true,
				fingerprint: "closed",
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
			equipment: {
				OHB: { groupCount: 1, portCount: 1 },
				EQ: { groupCount: 0, portCount: 0 },
				STK: { groupCount: 0, portCount: 0 },
			},
		});
		const markup = panelMarkup(portEvidence);
		const activeMarkup = panelMarkup(portEvidence, true);

		expect(markup).toContain('data-current-mission="ports"');
		expect(markup).toContain("EQ Port 행 배치");
		expect(markup).toContain('aria-valuetext="4 / 12 · EQ Port 행 배치"');
		expect(markup).toContain('data-testid="guided-build-mission-detail">STEP 2/3');
		expect(markup).not.toContain("MISSION 4 · PORTS · 2/3");
		expect(markup).toContain("EQUIP · EQ 열기");
		expect(markup).toContain("LMB DRAG");
		expect(markup).toContain("OHB 1/1 · EQ 0/2 · STK 0/2");
		expect(markup).toContain("같은 직선 레일 위 청록 CENTER 표식 두 개를 한 번에 드래그");
		expect(activeMarkup).not.toContain("EQUIP · EQ 열기");
		expect(activeMarkup).toContain("OHB 1/1 · EQ 0/2 · STK 0/2");
	});

	it("changes reuse coaching without treating selection as authored completion", () => {
		const reuseEvidence = evidence({
			navigationAcknowledged: true,
			authoredRevision: 5,
			readiness: {
				status: "ready",
				ready: true,
				fingerprint: "single-loop",
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
			equipment: {
				OHB: { groupCount: 1, portCount: 1 },
				EQ: { groupCount: 1, portCount: 2 },
				STK: { groupCount: 1, portCount: 2 },
			},
			reuseGuidance: {
				selectionAnchorReady: false,
				reusableSelectionReady: true,
				placementActive: false,
			},
		});
		const markup = panelMarkup(reuseEvidence);
		const placementMarkup = panelMarkup(
			evidence({
				...reuseEvidence,
				reuseGuidance: {
					selectionAnchorReady: false,
					reusableSelectionReady: true,
					placementActive: true,
				},
			}),
		);

		expect(markup).toContain('data-current-mission="reuse-loop"');
		expect(markup).toContain("Port 포함 Loop 복제");
		expect(markup).toContain("선택한 레일과 OHB·EQ·STK를 함께 복사");
		expect(markup).toContain("COPY · Port 포함 Loop 복제");
		expect(markup).toContain("⌘ / CTRL + C");
		expect(placementMarkup).toContain("공간이 부족하면 −로 축소한 뒤");
		expect(placementMarkup).toContain("기존 Loop와 겹치지 않는 정렬된 위치");
	});

	it("hands practice off before opening the ordinary Twin Bay placement", () => {
		const base = {
			navigationAcknowledged: true,
			authoredRevision: 8,
			readiness: {
				status: "blocked" as const,
				ready: false,
				fingerprint: "reused",
				issues: [
					{ code: "DISCONNECTED_NETWORK" as const },
					{ code: "MULTIPLE_STRONG_COMPONENTS" as const },
					{ code: "PHYSICAL_DISCONNECTED" as const },
				],
				summary: {
					edges: 48,
					closure: "closed" as const,
					weakComponents: 2,
					strongComponents: 2,
					openTerminals: 0,
					physicalOpenPaths: 0,
					physicalStrongComponents: 2,
				},
			},
			equipment: {
				OHB: { groupCount: 2, portCount: 2 },
				EQ: { groupCount: 2, portCount: 4 },
				STK: { groupCount: 2, portCount: 4 },
			},
			railReuse: {
				weakComponentCount: 2,
				networkLinkSupportedComponentCount: 2,
				repeatedComponentKindCount: 1,
				repeatedComponentCopyCount: 2,
			},
		};
		const choose = panelMarkup(evidence(base));
		const graduatedBase = { ...base, practiceGraduated: true };
		const start = panelMarkup(evidence(graduatedBase));
		const place = panelMarkup(
			evidence({ ...graduatedBase, bayGuidance: { placementActive: true } }),
		);

		expect(choose).toContain('data-current-mission="bay"');
		expect(choose).toContain("연습을 마치고 FAB 시작");
		expect(choose).toContain("START FAB · 새 프로젝트");
		expect(choose).not.toContain("가리킨 항목 적용");
		expect(start).toContain("기본 Twin Bay 시작");
		expect(start).toContain("ASSEMBLE · 기본 TWIN BAY");
		expect(place).toContain("기본 Twin Bay 배치");
		expect(place).toContain("−로 Twin Bay 전체가 보일 때까지 축소");
		expect(place).toContain("LMB");
	});

	it("offers ordinary Bay selection and duplication actions without inventing a mutation shortcut", () => {
		const base = completedThroughTwinBay();
		const select = panelMarkup(evidence(base));
		const duplicate = panelMarkup(
			evidence({
				...base,
				bayBankGuidance: {
					...bankGuidance(),
					selectedOrganizationCount: 1,
					selectedTwinBayCount: 1,
				},
			}),
		);
		const pair = panelMarkup(
			evidence({
				...base,
				bay: { semanticBayCount: 2, twinProductionBayCount: 2, directProcessLoopCount: 4 },
				bayBank: bankEvidence({ twinProductionBayCount: 2, detachedTwinBayCount: 2 }),
				bayBankGuidance: {
					...bankGuidance(),
					organizationBrowserOpen: true,
					selectedOrganizationCount: 1,
					selectedTwinBayCount: 1,
				},
			}),
		);

		expect(select).toContain('data-current-mission="bay-bank"');
		expect(select).toContain("ASSEMBLE · BAY 선택");
		expect(duplicate).toContain("DUPLICATE · 하위 계층 포함");
		expect(duplicate).not.toContain("⌘ / CTRL + C");
		expect(pair).toContain("원본과 복제 Twin Bay를 차례로 탭하세요");
	});

	it("marks only the active Connector guidance with the compact presentation", () => {
		const base = {
			...completedThroughTwinBay(),
			bay: { semanticBayCount: 2, twinProductionBayCount: 2, directProcessLoopCount: 4 },
			bayBank: bankEvidence({
				twinProductionBayCount: 2,
				detachedTwinBayCount: 2,
				alignedDetachedTwinBayPairCount: 1,
			}),
		};
		const beforeConnector = panelMarkup(
			evidence({
				...base,
				bayBankGuidance: {
					...bankGuidance(),
					selectedOrganizationCount: 2,
					selectedTwinBayCount: 2,
					selectedTwinBayPairAligned: true,
				},
			}),
		);
		const activeConnector = panelMarkup(
			evidence({
				...base,
				bayBankGuidance: {
					...bankGuidance(),
					selectedOrganizationCount: 2,
					selectedTwinBayCount: 2,
					selectedTwinBayPairAligned: true,
					connectorPhase: "pick-source-gateway",
				},
			}),
		);

		expect(beforeConnector).toContain('data-presentation="default"');
		expect(beforeConnector).toContain("두 Production Bay 연결");
		expect(activeConnector).toContain('data-presentation="connector"');
		expect(activeConnector).toContain("Source Gateway 선택");
	});
});

function panelMarkup(evidenceValue: GuidedBuildEvidence, suggestedActionActive = false): string {
	return renderToStaticMarkup(
		<GuidedBuildPanel
			evaluation={evaluateGuidedBuildFoundation(evidenceValue)}
			suggestedActionActive={suggestedActionActive}
			onAcknowledgeNavigation={() => undefined}
			onActivateSuggestedAction={() => undefined}
			onExit={() => undefined}
		/>,
	);
}

function linkSupportedRailReuse(): GuidedBuildEvidence["railReuse"] {
	return {
		weakComponentCount: 1,
		networkLinkSupportedComponentCount: 1,
		repeatedComponentKindCount: 0,
		repeatedComponentCopyCount: 0,
	};
}

function evidence(overrides: Partial<GuidedBuildEvidence> = {}): GuidedBuildEvidence {
	return {
		navigationAcknowledged: false,
		practiceGraduated: false,
		authoredRevision: 0,
		readiness: {
			status: "empty",
			ready: false,
			fingerprint: "empty",
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
		},
		equipment: {
			OHB: { groupCount: 0, portCount: 0 },
			EQ: { groupCount: 0, portCount: 0 },
			STK: { groupCount: 0, portCount: 0 },
		},
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
		checks: {
			available: false,
			ready: false,
			fingerprint: "",
			blockingIssueCount: 0,
			followUpIssueCount: 0,
			separateRailNetworkCount: 0,
		},
		checksGuidance: {
			navigatorOpen: false,
			inspectionPending: false,
			acknowledgedFingerprint: null,
			networkLinkRepairAvailable: true,
			networkLinkRepairActive: false,
			networkLinkSourceSelected: false,
		},
		projectPersistence: {
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
		},
		...overrides,
	};
}

function completedThroughTwinBay(): Partial<GuidedBuildEvidence> {
	return {
		navigationAcknowledged: true,
		practiceGraduated: true,
		authoredRevision: 9,
		readiness: {
			status: "blocked",
			ready: false,
			fingerprint: "guided-bank",
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
		},
		equipment: {
			OHB: { groupCount: 2, portCount: 2 },
			EQ: { groupCount: 2, portCount: 4 },
			STK: { groupCount: 2, portCount: 4 },
		},
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

function bankGuidance(): GuidedBuildEvidence["bayBankGuidance"] {
	return {
		placementActive: false,
		organizationBrowserOpen: false,
		selectedOrganizationCount: 0,
		selectedTwinBayCount: 0,
		selectedTwinBayPairAligned: false,
		arrangementPhase: "inactive",
		connectorPhase: "inactive",
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

function interbayGuidance(): GuidedBuildEvidence["interbayGuidance"] {
	return {
		placementActive: false,
		organizationBrowserOpen: false,
		selectedOrganizationCount: 0,
		selectedBayBankCount: 0,
		selectedBayBankPairAligned: false,
		arrangementPhase: "inactive",
		connectorPhase: "inactive",
	};
}

function interbayEvidence(): GuidedBuildEvidence["interbay"] {
	return {
		semanticBayBankCount: 0,
		detachedBayBankCount: 0,
		semanticFabCount: 0,
		interbayFabCount: 0,
		fabBankCount: 0,
	};
}

function fabLoopGuidance(): GuidedBuildEvidence["fabLoopGuidance"] {
	return {
		organizationBrowserOpen: false,
		selectedOrganizationCount: 0,
		selectedBayBankCount: 0,
		connectorPhase: "inactive",
	};
}

function fabLoopEvidence(): GuidedBuildEvidence["fabLoop"] {
	return {
		semanticFabCount: 0,
		eligibleFabCount: 0,
		resilientFabLoopCount: 0,
		resilientBankPairCount: 0,
	};
}
