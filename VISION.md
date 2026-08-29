# OpenFab 프로젝트 비전 문서 (Vision & Product Direction)

> 이 문서는 OpenFab 프로젝트의 장기 방향과 제품 철학을 정의하는 최상위 문서다.
> `DEPLOYMENT_STRATEGY.md`와 함께, 모든 설계·구현 판단에 적용되는 프로젝트 원칙이다.
> 현재 단계의 구체적 작업 순서는 `docs/HANDOFF.md`가 관리한다.

## 1. 프로젝트 개요

OpenFab은 단순한 FAB 레일 에디터가 아니다.

프로젝트의 최종 목표는 **반도체 FAB(Factory)의 설계, 시뮬레이션, 분석 및 최적화를 위한
오픈소스 Digital Twin 플랫폼**을 만드는 것이다.

즉, "레일을 그리는 프로그램"이 아니라
**"FAB를 설계하고, 시뮬레이션하고, 분석하고, 최적화하는 플랫폼"**을 목표로 한다.

## 2. 프로젝트를 시작하게 된 이유

현재 상용 FAB 시뮬레이션 프로그램들은 대부분 다음과 같은 특징을 가진다.

- 매우 고가
- 폐쇄적인 구조
- 확장이 어려움
- 외부 개발자가 접근하기 어려움
- 연구 목적으로 사용하기 어려움

또한 공개적으로 사용할 수 있는 FAB 전용 오픈소스 플랫폼은 거의 존재하지 않는다.
OpenFab은 이러한 문제를 해결하기 위해 시작된 프로젝트이다.

## 3. 핵심 철학

### 3.1 현실적인 Factory를 표현한다

단순히 OHT가 움직이는 애니메이션을 만드는 것이 아니다.
실제 Factory에서 발생하는 **물류, 병목, 차량 이동, Layout 변경, 생산 흐름**을
실험할 수 있어야 한다.

### 3.2 연구 플랫폼

OpenFab은 논문을 작성하기 위한 실험 플랫폼으로도 사용할 수 있어야 한다.

- Routing Algorithm 비교
- Dispatch 비교
- Congestion 분석
- Digital Twin 연구
- Traffic 분석

등을 동일한 환경에서 **재현 가능**해야 한다.

### 3.3 확장 가능한 구조

모든 기능은 Plugin 형태로 확장 가능해야 한다.

```text
Core Engine
├── Fab Plugin
├── Warehouse Plugin
├── AGV Plugin
└── Rail Plugin
```

처럼 다양한 산업에 적용 가능한 구조를 목표로 한다.

### 3.4 누구나 사용할 수 있는 오픈 플랫폼

학생, 연구자, 개발자, 기업 모두 사용할 수 있어야 한다.

## 4. 절대로 목표가 아닌 것

- OpenFab은 **"회사 프로젝트를 복제"하는 것이 아니다.**
- 특정 고객사의 FAB를 구현하는 것도 아니다.

OpenFab은 **범용적인 Factory Simulation Platform**이다.

모든 데이터는 다음을 기반으로 한다.

- 직접 제작
- 공개 가능한 자료
- 임의 생성 데이터

다음은 절대 포함하지 않는다.

- 회사 코드
- 회사 Layout
- 회사 알고리즘
- 회사 내부 문서

## 5. 제품의 최종 모습

최종적으로 OpenFab은 아래와 같은 하나의 플랫폼이 된다.

```text
OpenFab
├── Project Manager
├── Layout Editor
├── Rail Editor
├── Object Editor
├── Scenario Editor
├── Simulation Engine
├── Playback
├── Analytics
├── Optimization
├── Plugin System
├── Cloud Sync
└── Enterprise Extension
```

## 6. 개발 로드맵

### Stage 1 — Map Editor (현재 진행 중)

목표: 누구나 손쉽게 FAB 레이아웃을 구성할 수 있는 환경.

포함 기능: Rail 생성, Node 편집, Curve 생성, Junction 생성, Object 배치, Grid, Snap, Layer

### Stage 2 — Simulation Engine

Layout 위에서 실제 차량이 움직인다.

OHT, Vehicle, Carrier, Pickup, Drop, Collision, Reservation, Signal, Routing

### Stage 3 — Scenario

반송을 생성한다.

Random Transfer, CSV Import, Batch Simulation, Seed 고정, Scenario 저장

### Stage 4 — Analytics

Simulation 결과를 분석한다.

Heatmap, Throughput, Waiting Time, Congestion, Bottleneck, Utilization, Statistics

### Stage 5 — Playback

Simulation 결과를 기록하고 재생한다.

Timeline, Seek, Replay, Event, Snapshot, Reverse Playback

### Stage 6 — Optimization

알고리즘을 비교한다.

예시: Dijkstra, A*, Congestion Routing, Dispatch Rule, Idle Vehicle Positioning

### Stage 7 — Plugin

누구나 새로운 기능을 추가할 수 있다.

예시: Fab Plugin, Warehouse Plugin, Port Plugin, Airport Plugin, AGV Plugin, Robot Plugin

## 7. 핵심 차별점

OpenFab의 핵심은 "예쁜 3D"가 아니다. 핵심은 **Simulation**이다.

- Simulation이 없는 Rail Editor는 단순한 Drawing Tool이다.
- Simulation이 추가되는 순간 **Engineering Platform**이 된다.
- Analytics가 추가되면 **Decision Platform**이 된다.
- Optimization까지 추가되면 **Research Platform**이 된다.

## 8. 논문 활용

OpenFab은 다양한 연구를 수행할 수 있는 플랫폼을 목표로 한다.

Routing Algorithm, Dispatch Algorithm, Congestion Prediction, Digital Twin,
Traffic Simulation, Fleet Sizing, Idle Vehicle Positioning, Bottleneck Detection
등을 동일한 플랫폼에서 실험할 수 있다.

## 9. 특허 가능성

OpenFab 자체를 특허로 생각하지 않는다.
대신 OpenFab 내부의 개별 기술은 특허를 검토할 수 있다.

예: Snapshot Interpolation, Dynamic Routing, Traffic Prediction,
Congestion Detection, Replay Engine

## 10. 오픈소스 전략

처음부터 Public Repository를 운영하는 것이 목표가 아니다.

```text
Private Repository
→ 충분한 개발 및 구조 안정화
→ 지식재산 및 코드 검토
→ 새로운 Public Repository 생성
→ 공개 가능한 코드만 이관
→ Open Source 운영 시작
```

Git History까지 그대로 공개하는 것이 아니라,
**깨끗한 공개 저장소를 새로 시작하는 것**을 원칙으로 한다.

## 11. 성공 기준

OpenFab의 성공은 GitHub Star 개수가 아니다. 성공의 기준은 다음과 같다.

- 연구실에서 실험 플랫폼으로 사용된다.
- 논문에서 OpenFab이 인용된다.
- 개발자가 Plugin을 만든다.
- 학생들이 학습용으로 사용한다.
- 기업이 PoC(Prototyping)에 활용한다.
- 오픈소스 커뮤니티가 형성된다.

## 12. 장기 비전

OpenFab은 "FAB Viewer"가 아니다. "OHT Simulator"도 아니다.

OpenFab은 **Factory Digital Twin Platform**이다.

향후에는 반도체 FAB, 물류센터, AGV 공장, 스마트팩토리, 자동창고 등
다양한 산업으로 확장 가능한 범용 Simulation Platform을 목표로 한다.

## 13. 개발 원칙

모든 구현은 아래 원칙을 따른다.

1. 확장성(Extensibility)을 우선한다.
2. 데이터 중심(Data-Driven) 구조를 유지한다.
3. Plugin 구조를 유지한다.
4. 재현 가능한 Simulation을 제공한다.
5. 실제 산업 적용 가능성을 항상 고려한다.
6. 특정 회사나 고객 환경에 종속되지 않는다.
7. 오픈소스로 공개 가능한 코드만 포함한다.

## 최종 목표

OpenFab의 궁극적인 목표는
**"세계에서 가장 널리 사용되는 오픈소스 Factory Digital Twin 플랫폼"**을 만드는 것이다.

이 프로젝트는 단순히 레일을 그리는 프로그램이 아니라,
설계·시뮬레이션·분석·연구를 하나의 생태계로 연결하는 기반 플랫폼을 지향한다.
