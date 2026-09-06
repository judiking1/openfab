import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GuidedBuildChapterId } from "./GuidedBuildChapter";
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

	it("offers protected recovery without removing the three new-project paths", () => {
		const markup = renderToStaticMarkup(
			<OpenFabStartDialog
				recovery={{ projectName: "OpenFab Process Hall", totalCount: 55 }}
				onResumeRecovery={() => undefined}
				onReviewRecovery={() => undefined}
				onGuidedBuild={() => undefined}
				onVerifiedTemplate={() => undefined}
				onBlankCanvas={() => undefined}
				onClose={() => undefined}
			/>,
		);

		expect(markup).toContain('aria-label="복구본 이어하기"');
		expect(markup).toContain("새로 시작해도 복구본은 자동으로 삭제되지 않습니다");
		expect(markup).toContain("OpenFab Process Hall");
		expect(markup).toContain("전체 55개");
		expect(markup).toContain("최신 복구본 이어하기");
		expect(markup).toContain("다른 복구본 보기");
		expect(markup).toContain("GUIDED BUILD");
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
		expect(markup).toContain('aria-valuetext="전체 미션 2/12 · 첫 단방향 레일"');
		expect(markup).toContain("GUIDED BUILD · 챕터 1/4 · QUICK START");
		expect(markup).toContain("QUICK START");
		expect(markup).toContain("미션 2/3 · 전체 미션 2/12");
		expect(markup).not.toContain("MISSION 2 · FIRST RAIL");
		expect(markup).not.toContain('data-testid="guided-build-mission-detail"');
		expect(markup).not.toContain("닫힌 Process Loop: locked");
		expect(markup).toContain("현재 도구 드래그");
		expect(markup).toContain("TOUCH DRAG");
		expect(markup).toContain("LMB DRAG");
		expect(markup).toContain('data-testid="guided-build-progress-cue"');
		expect(markup).toContain("가장 긴 직선 0 / 15 m");
		expect(markup).toContain("가로 또는 세로로 15 m 이상");
		expect(markup).not.toContain("모든 Process Loop와 Bay는");
		expect(markup).not.toContain("이동을 익혔어요");
		expect(markup).toContain("이 단계 도움말");
		expect(markup).toContain('aria-label="Guided Build 최소화"');
		expect(markup).toContain('aria-label="Guided Build 종료"');
		expect(markup).toContain('aria-label="Guided Build 미션 이동"');
		expect(markup).toContain("현재 미션 진행 중");
		expect(markup).toContain("조건 충족 시 자동 진행");
		expect(markup.match(/aria-live="polite"/g)).toHaveLength(1);
		expect(markup).toContain('role="status" aria-live="polite" aria-atomic="true"');
		expect(markup).not.toContain("현재 조건을 완료하면 다음 단계가 자동으로 열립니다");
		expect(markup).toContain('aria-expanded="false"');
		expect(markup).not.toContain('data-testid="guided-build-mission-help"');
		expect(markup).not.toContain('data-testid="editor-command-help"');
	});

	it("keeps a managed Reuse Canvas instruction visible without reviving its proxy", () => {
		const reuseEvidence = evidence({
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
				OHB: { groupCount: 1, portCount: 1, largestGroupPortCount: 1 },
				EQ: { groupCount: 1, portCount: 2, largestGroupPortCount: 2 },
				STK: { groupCount: 1, portCount: 2, largestGroupPortCount: 2 },
			},
		});
		const markup = panelMarkup(
			reuseEvidence,
			false,
			null,
			null,
			true,
			"Canvas의 ‘이 레일 탭’ 고리에서 원본 Process Loop를 선택하세요.",
		);

		expect(markup).toContain('data-current-mission="reuse-loop"');
		expect(markup).toContain('data-testid="guided-build-primary-instruction"');
		expect(markup).toContain("Canvas의 ‘이 레일 탭’ 고리");
		expect(markup).toContain("원본 Loop 항목 선택");
		expect(markup).toContain("TAP");
		expect(markup).toContain("ENTER / SPACE");
		expect(markup).not.toContain('data-testid="guided-build-suggested-action"');
	});

	it("keeps the managed connected-selection instruction while the shared command owns input", () => {
		const reuseEvidence = evidence({
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
				OHB: { groupCount: 1, portCount: 1, largestGroupPortCount: 1 },
				EQ: { groupCount: 1, portCount: 2, largestGroupPortCount: 2 },
				STK: { groupCount: 1, portCount: 2, largestGroupPortCount: 2 },
			},
			reuseGuidance: {
				selectionAnchorReady: true,
				reusableSelectionReady: false,
				placementActive: false,
			},
		});
		const markup = panelMarkup(
			reuseEvidence,
			false,
			null,
			null,
			true,
			"아래 강조된 ‘연결 구조 전체’를 선택하세요. O 키로도 실행할 수 있습니다.",
		);

		expect(markup).toContain('data-current-mission="reuse-loop"');
		expect(markup).toContain('data-testid="guided-build-primary-instruction"');
		expect(markup).toContain("강조된 ‘연결 구조 전체’");
		expect(markup).toContain("Port 포함 Loop 전체 선택");
		expect(markup).not.toContain('data-testid="guided-build-suggested-action"');
	});

	it("keeps the managed copy instruction while the shared command owns input", () => {
		const reuseEvidence = evidence({
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
				OHB: { groupCount: 1, portCount: 1, largestGroupPortCount: 1 },
				EQ: { groupCount: 1, portCount: 2, largestGroupPortCount: 2 },
				STK: { groupCount: 1, portCount: 2, largestGroupPortCount: 2 },
			},
			reuseGuidance: {
				selectionAnchorReady: false,
				reusableSelectionReady: true,
				placementActive: false,
			},
		});
		const markup = panelMarkup(
			reuseEvidence,
			false,
			null,
			null,
			true,
			"아래 강조된 ‘정적 FAB 복제’를 선택하세요. ⌘/Ctrl+C도 같은 명령입니다.",
		);

		expect(markup).toContain('data-current-mission="reuse-loop"');
		expect(markup).toContain('data-testid="guided-build-primary-instruction"');
		expect(markup).toContain("강조된 ‘정적 FAB 복제’");
		expect(markup).toContain("Port 포함 Loop 복제");
		expect(markup).not.toContain('data-testid="guided-build-suggested-action"');
	});

	it("offers a secondary keyboard Rail entry and phase-specific 44 px action labels", () => {
		const evaluation = evaluateGuidedBuildFoundation(evidence({ navigationAcknowledged: true }));
		const inactive = renderToStaticMarkup(
			<GuidedBuildPanel
				evaluation={evaluation}
				onAcknowledgeNavigation={() => undefined}
				onActivateSuggestedAction={() => undefined}
				onContinueChapter={() => undefined}
				onStartEditing={() => undefined}
				onStartKeyboardRail={() => undefined}
				onApplyKeyboardRail={() => undefined}
				onCancelKeyboardRail={() => undefined}
				onMinimize={() => undefined}
				onExit={() => undefined}
			/>,
		);
		const active = renderToStaticMarkup(
			<GuidedBuildPanel
				evaluation={evaluation}
				keyboardRail={{ mission: "first-rail", phase: "choose-end" }}
				onAcknowledgeNavigation={() => undefined}
				onActivateSuggestedAction={() => undefined}
				onContinueChapter={() => undefined}
				onStartEditing={() => undefined}
				onStartKeyboardRail={() => undefined}
				onApplyKeyboardRail={() => undefined}
				onCancelKeyboardRail={() => undefined}
				onMinimize={() => undefined}
				onExit={() => undefined}
			/>,
		);

		expect(inactive.match(/data-testid="guided-build-keyboard-rail-entry"/g)).toHaveLength(1);
		expect(inactive).not.toContain('data-guided-target="true"');
		expect(inactive).toContain("키보드로 레일 만들기");
		expect(active).toContain('data-testid="guided-build-keyboard-rail-hint"');
		expect(active).toContain("방향키 1 m · SHIFT+방향키 5 m · ENTER 확정");
		expect(active).toContain("구간 확정 · Enter");
		expect(active).toContain("구간 취소 · Esc");
		expect(active).toContain("키보드 레일을 확정하거나 취소한 뒤 단계 이동");
		expect(active).not.toContain('data-guided-target="true"');
	});

	it("shows the acknowledgement only for the semantic orientation step", () => {
		const markup = panelMarkup(evidence());

		expect(markup).toContain('data-current-mission="orient"');
		expect(markup).toContain('aria-valuetext="전체 미션 1/12 · 캔버스 익히기"');
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
		expect(
			guidedBuildInputHint("command.apply", {
				inputs: ["ENTER"],
				inputJoin: "plus",
				pointer: false,
			}),
		).toEqual({
			inputs: ["적용 버튼", "TAB → APPLY → ENTER"],
			inputJoin: "or",
			pointer: true,
		});
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
		expect(markup).toContain("먼저 바깥으로 최소 6칸 뻗고");
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
					OHB: { groupCount: 2, portCount: 2, largestGroupPortCount: 1 },
					EQ: { groupCount: 2, portCount: 4, largestGroupPortCount: 2 },
					STK: { groupCount: 2, portCount: 4, largestGroupPortCount: 2 },
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
			false,
			null,
			null,
			false,
			null,
			"action:continue-editing",
		);

		expect(markup).toContain('data-current-mission="complete"');
		expect(markup).toContain('aria-valuetext="전체 미션 12/12 · 완료"');
		expect(markup).toContain("첫 정적 FAB 작업 흐름 완료");
		expect(markup).toContain("가이드 종료 · 편집 계속");
		expect(markup).toContain('data-guided-action-id="action:continue-editing"');
		expect(markup).toContain('data-guided-target="true"');
		expect(markup).toContain('aria-describedby="tilefab-guided-primary-target-description"');
		expect(markup).toContain("이 안내와 CHECKS 결과를 닫고 일반 Inspect 편집으로 돌아갑니다");
		expect(markup).not.toContain('aria-label="Guided Build 최소화"');
		expect(markup).not.toContain("<span>접기</span>");
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
				OHB: { groupCount: 1, portCount: 1, largestGroupPortCount: 1 },
				EQ: { groupCount: 0, portCount: 0, largestGroupPortCount: 0 },
				STK: { groupCount: 0, portCount: 0, largestGroupPortCount: 0 },
			},
		});
		const markup = panelMarkup(portEvidence);
		const activeMarkup = panelMarkup(portEvidence, true);
		const workspaceMarkup = panelMarkup(
			portEvidence,
			true,
			null,
			{
				portType: "EQ",
				phase: "choose-end",
			},
			true,
			null,
			undefined,
			"EQ",
		);
		const otherEquipmentMarkup = panelMarkup(
			portEvidence,
			true,
			null,
			null,
			true,
			null,
			undefined,
			"OHB",
		);
		const keyboardMarkup = panelMarkup(portEvidence, true, null, {
			portType: "EQ",
			phase: "choose-end",
		});
		const actualOwnerMarkup = panelMarkup(portEvidence, false, null, null, true);
		const waitingMarkup = panelMarkup(
			portEvidence,
			false,
			null,
			null,
			true,
			"Rail mirror Worker를 동기화하는 중입니다.",
		);

		expect(markup).toContain('data-current-mission="ports"');
		expect(markup).toContain('data-current-chapter="equip"');
		expect(markup).toContain("GUIDED BUILD · 챕터 2/4 · EQUIP");
		expect(markup).toContain("EQ Port 행 배치");
		expect(markup).toContain('aria-valuetext="전체 미션 4/12 · EQ Port 행 배치"');
		expect(markup).toContain('data-testid="guided-build-mission-detail">PORTS · 작업 2/3');
		expect(markup).not.toContain("MISSION 4 · PORTS · 2/3");
		expect(markup).toContain("EQUIP · EQ 열기");
		expect(markup).toContain("LMB</strong>");
		expect(markup).toContain("OHB 1/1 · EQ 0/2 · STK 0/2");
		expect(markup).toContain("청록색 1 시작과 2 끝");
		expect(activeMarkup).not.toContain("EQUIP · EQ 열기");
		expect(activeMarkup).toContain("OHB 1/1 · EQ 0/2 · STK 0/2");
		expect(activeMarkup).toContain("EQ 도구가 준비됐습니다");
		expect(activeMarkup).toContain("시작점과 끝점을 차례로 클릭");
		expect(activeMarkup).toContain("각 위치에서 Enter");
		expect(activeMarkup).not.toContain("왼쪽의 강조된 EQ");
		expect(workspaceMarkup).toContain('data-equipment-workspace="true"');
		expect(workspaceMarkup).toContain("EQ Port 행 배치");
		expect(workspaceMarkup).toContain('aria-valuetext="전체 미션 4/12 · EQ Port 행 배치"');
		expect(workspaceMarkup).toContain("이 단계 도움말");
		expect(workspaceMarkup).not.toContain('data-testid="guided-build-progress-cue"');
		expect(workspaceMarkup).not.toContain('data-testid="guided-build-keyboard-port-hint"');
		expect(otherEquipmentMarkup).not.toContain('data-equipment-workspace="true"');
		expect(otherEquipmentMarkup).toContain('data-testid="guided-build-progress-cue"');
		const stkActiveMarkup = panelMarkup(
			{
				...portEvidence,
				equipment: {
					...portEvidence.equipment,
					EQ: { groupCount: 1, portCount: 2, largestGroupPortCount: 2 },
				},
			},
			true,
		);
		expect(stkActiveMarkup).toContain("선택을 확인한 뒤 STK 생성 또는 Shift+Enter");
		expect(stkActiveMarkup).not.toContain("선택하면 그룹이 완성됩니다");
		expect(keyboardMarkup).toContain('data-testid="guided-build-keyboard-port-hint"');
		expect(keyboardMarkup).toContain("KEYBOARD EQ");
		expect(keyboardMarkup).toContain("방향키 / WASD · ENTER 행 확정");
		expect(keyboardMarkup).toContain("키보드 Port 배치를 확정하거나 Esc로 취소한 뒤 단계 이동");
		expect(keyboardMarkup).not.toContain("LMB DRAG</strong>");
		expect(actualOwnerMarkup).not.toContain('data-testid="guided-build-suggested-action"');
		expect(actualOwnerMarkup).not.toContain("EQUIP · EQ 열기");
		expect(waitingMarkup).toContain("Rail mirror Worker를 동기화하는 중입니다.");
		expect(waitingMarkup).not.toContain('data-testid="guided-build-suggested-action"');
		expect(waitingMarkup).not.toContain("EQUIP · EQ 열기");
	});

	it("pauses at an adjacent chapter checkpoint without exposing the next mission objective", () => {
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
		});
		const markup = panelMarkup(portEvidence, false, "quick-start");

		expect(markup).toContain('data-chapter-checkpoint="quick-start"');
		expect(markup).toContain('data-testid="guided-build-chapter-checkpoint"');
		expect(markup).toContain("QUICK START COMPLETE");
		expect(markup).toContain("레일 기본기 완료");
		expect(markup).toContain("레일 기본기를 익혔습니다");
		expect(markup).toContain("다음 과정 · EQUIP");
		expect(markup).toContain("잠시 접고 편집");
		expect(markup).not.toContain("OHB, EQ, STK의 대표 Port");
		expect(markup).not.toContain("조건 충족 시 자동 진행");
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
				OHB: { groupCount: 1, portCount: 1, largestGroupPortCount: 1 },
				EQ: { groupCount: 1, portCount: 2, largestGroupPortCount: 2 },
				STK: { groupCount: 1, portCount: 2, largestGroupPortCount: 2 },
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
				OHB: { groupCount: 2, portCount: 2, largestGroupPortCount: 1 },
				EQ: { groupCount: 2, portCount: 4, largestGroupPortCount: 2 },
				STK: { groupCount: 2, portCount: 4, largestGroupPortCount: 2 },
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
		expect(place).toContain("‘여기를 탭’ 표식을 눌러 현재 위치에 배치");
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
		expect(select).toContain("TWIN BAY 목록 열기");
		expect(duplicate).toContain("DUPLICATE · TWIN BAY 전체 복제");
		expect(duplicate).not.toContain("⌘ / CTRL + C");
		expect(pair).toContain("원본 Twin Bay는 이미 선택되어 있습니다(✓)");
		expect(pair).toContain('data-presentation="picker"');
		expect(pair).toContain("FAB ORGANIZATION 목록 선택");
		expect(pair).not.toContain("Canvas FAB 조직 선택");
	});

	it("publishes the visible organization CTA as the described Guided owner", () => {
		const markup = renderToStaticMarkup(
			<GuidedBuildPanel
				evaluation={evaluateGuidedBuildFoundation(evidence(completedThroughTwinBay()))}
				suggestedActionGuidedActionId="action:browse-bays"
				suggestedActionGuidedTarget
				suggestedActionDescriptionId="guided-next-description"
				onAcknowledgeNavigation={() => undefined}
				onActivateSuggestedAction={() => undefined}
				onContinueChapter={() => undefined}
				onStartEditing={() => undefined}
				onMinimize={() => undefined}
				onExit={() => undefined}
			/>,
		);

		expect(markup).toContain('data-testid="guided-build-suggested-action"');
		expect(markup).toContain('data-guided-action-id="action:browse-bays"');
		expect(markup).toContain('data-guided-target="true"');
		expect(markup).toContain('aria-describedby="guided-next-description"');
		expect(markup).not.toContain('class="tilefab-guided-build-hint"');
		expect(markup).toContain("강조된 작업을 완료해 계속");
		expect(markup).not.toContain("조건 충족 시 자동 진행");
	});

	it("locks completed-step review while an exclusive organization command is active", () => {
		const markup = renderToStaticMarkup(
			<GuidedBuildPanel
				evaluation={evaluateGuidedBuildFoundation(evidence(completedThroughTwinBay()))}
				exclusiveCommandActive
				onAcknowledgeNavigation={() => undefined}
				onActivateSuggestedAction={() => undefined}
				onContinueChapter={() => undefined}
				onStartEditing={() => undefined}
				onMinimize={() => undefined}
				onExit={() => undefined}
			/>,
		);

		expect(markup).toContain('title="현재 검토를 적용하거나 취소한 뒤 단계 이동"');
		expect(markup).toMatch(
			/<button[^>]*disabled=""[^>]*title="현재 검토를 적용하거나 취소한 뒤 단계 이동"[^>]*>/,
		);
	});

	it("gives a manual Arrangement review one external action owner", () => {
		const base = completedThroughTwinBay();
		const evaluation = evaluateGuidedBuildFoundation(
			evidence({
				...base,
				bay: { semanticBayCount: 2, twinProductionBayCount: 2, directProcessLoopCount: 4 },
				bayBank: bankEvidence({ twinProductionBayCount: 2, detachedTwinBayCount: 2 }),
				bayBankGuidance: {
					...bankGuidance(),
					selectedOrganizationCount: 2,
					selectedTwinBayCount: 2,
					arrangementPhase: "certified",
				},
			}),
		);
		const markup = renderToStaticMarkup(
			<GuidedBuildPanel
				evaluation={evaluation}
				exclusiveCommandActive
				onAcknowledgeNavigation={() => undefined}
				onActivateSuggestedAction={() => undefined}
				onContinueChapter={() => undefined}
				onStartEditing={() => undefined}
				onMinimize={() => undefined}
				onExit={() => undefined}
			/>,
		);

		expect(markup).toContain("중심 정렬 검증·적용");
		expect(markup).toContain("강조된 검토 작업을 완료해 계속");
		expect(markup).not.toContain("조건 충족 시 자동 진행");
		expect(markup).not.toContain('class="tilefab-guided-build-hint"');
		expect(markup.match(/aria-live="polite"/g)).toHaveLength(1);
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
		expect(beforeConnector).toContain("두 Twin Bay 연결");
		expect(activeConnector).toContain('data-presentation="connector"');
		expect(activeConnector).toContain("출발 Gateway(연결 지점) 선택");
	});

	it("keeps an exact reopened project at 12/12 while fresh CHECKS are republished", () => {
		const markup = panelMarkup(
			evidence({
				...completedThroughTwinBay(),
				bay: { semanticBayCount: 2, twinProductionBayCount: 2, directProcessLoopCount: 4 },
				bayBank: bankEvidence({
					twinProductionBayCount: 4,
					semanticBayBankCount: 2,
					railBearingTwinBayBankCount: 2,
					bankedTwinBayCount: 4,
				}),
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

		expect(markup).toContain('data-current-mission="checks"');
		expect(markup).toContain("다시 연 프로젝트 최종 검사");
		expect(markup).toContain("미션 7/7 · 전체 미션 12/12 · 최종 확인");
		expect(markup).toContain('aria-valuetext="전체 미션 12/12 · 다시 연 프로젝트 최종 검사"');
		expect(markup).toContain("현재 미션 진행 중");
		expect(markup).toContain("다시 연 파일 검사");
		expect(markup).not.toContain("전체 미션 10/12");
	});
});

function panelMarkup(
	evidenceValue: GuidedBuildEvidence,
	suggestedActionActive = false,
	chapterCheckpointId: GuidedBuildChapterId | null = null,
	keyboardPort: ComponentProps<typeof GuidedBuildPanel>["keyboardPort"] = null,
	primaryTargetManaged = false,
	primaryTargetInstruction: string | null = null,
	completionActionGuidedActionId: string | undefined = undefined,
	equipmentWorkspaceType: ComponentProps<typeof GuidedBuildPanel>["equipmentWorkspaceType"] = null,
): string {
	return renderToStaticMarkup(
		<GuidedBuildPanel
			evaluation={evaluateGuidedBuildFoundation(evidenceValue)}
			suggestedActionActive={suggestedActionActive}
			chapterCheckpointId={chapterCheckpointId}
			keyboardPort={keyboardPort}
			equipmentWorkspaceType={equipmentWorkspaceType}
			primaryTargetManaged={primaryTargetManaged}
			primaryTargetInstruction={primaryTargetInstruction}
			completionActionGuidedActionId={completionActionGuidedActionId}
			completionActionGuidedTarget={completionActionGuidedActionId !== undefined}
			completionActionDescriptionId="tilefab-guided-primary-target-description"
			onAcknowledgeNavigation={() => undefined}
			onActivateSuggestedAction={() => undefined}
			onContinueChapter={() => undefined}
			onStartEditing={() => undefined}
			onMinimize={() => undefined}
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
			OHB: { groupCount: 0, portCount: 0, largestGroupPortCount: 0 },
			EQ: { groupCount: 0, portCount: 0, largestGroupPortCount: 0 },
			STK: { groupCount: 0, portCount: 0, largestGroupPortCount: 0 },
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
			OHB: { groupCount: 2, portCount: 2, largestGroupPortCount: 1 },
			EQ: { groupCount: 2, portCount: 4, largestGroupPortCount: 2 },
			STK: { groupCount: 2, portCount: 4, largestGroupPortCount: 2 },
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
