# OpenFab 배포 전략 및 제품 아키텍처 (Deployment Strategy)

> 이 문서는 OpenFab의 배포 전략과 제품 구조를 정의하는 최상위 문서다.
> `VISION.md`와 함께, 모든 설계·구현 판단에 적용되는 프로젝트 원칙이다.

## 목적

OpenFab은 특정 플랫폼을 위한 프로그램이 아니라 하나의 **Simulation Platform**이다.
따라서 개발 초기에는 특정 플랫폼(Electron, Steam 등)에 종속되지 않고,
모든 핵심 로직을 **플랫폼 독립적으로 설계**하는 것을 목표로 한다.

## 핵심 원칙

OpenFab은 "웹" 또는 "데스크톱" 중 하나를 선택하는 프로젝트가 아니다.

**하나의 Core Engine을 만들고, 여러 플랫폼에서 실행 가능한 구조**를 목표로 한다.

```text
Core
├── Web
├── Desktop
└── Cloud
```

## 왜 처음부터 Electron을 사용하지 않는가

Electron은 좋은 선택이지만, 현재 단계에서는 개발 속도를 늦출 가능성이 높다.

현재 필요한 것은 **Rail Editor, Layout Editor, Simulation**이지, 운영체제 기능이 아니다.

Electron은 파일 시스템, 창 관리, IPC, 패키징, 업데이트 등을 함께 고려해야 한다.
프로젝트 초기에는 이러한 요소보다 **Simulation 자체를 완성하는 것**이 중요하다.

## 초기 목표

OpenFab은 **React + TypeScript 기반의 Web Application**으로 개발한다.
이 단계에서는 **브라우저만 있으면 실행 가능**해야 한다.

초기 기능 — 모두 브라우저에서 실행 가능하도록 한다:

- Rail 생성
- Node 편집
- Curve 생성
- Object 배치
- Undo / Redo
- Project Save / Load
- Sample Project
- OHT Simulation

## 웹을 우선하는 이유

웹은 설치가 필요 없다. 사용자는 `GitHub → Live Demo → 즉시 실행`이 가능하다.

Open Source 프로젝트는 사용자가 설치하기 전에 먼저 체험할 수 있어야 한다.
초기 사용자(개발자, 학생, 연구자, 논문 작성자)에게 가장 적합한 방식이다.

초기 공개 Builder 산출물은 특정 정적 호스팅 사업자의 설정 파일이나 COOP/COEP 헤더를
요구하지 않는다. `SharedArrayBuffer`가 실제로 필요한 이후 Simulation Runtime은 별도의
opt-in 실행 모드와 플랫폼 어댑터에서 격리 헤더를 제공한다. Builder의 기본 배포 계약과
Runtime의 호스팅 계약을 섞지 않는다.

## 장기적인 제품 구조

OpenFab은 하나의 제품이 아니라 여러 제품으로 확장된다.
모든 제품은 **동일한 Core Engine을 공유**한다.

```text
OpenFab
├── Web
├── Desktop
├── Cloud
└── Enterprise
```

## 프로젝트 구조 (장기 목표)

```text
apps/
├── web/
└── desktop/
packages/
├── core/          # Simulation, Graph, Model, Routing
├── editor/
├── renderer/
├── simulation/
├── analytics/
├── plugin/
└── ui/
examples/
```

Core에는 Simulation, Graph, Model, Routing이 포함된다.
**React UI는 Core를 사용하는 하나의 Frontend일 뿐이다.**

## 플랫폼 독립 원칙

React Component 안에서 직접 `localStorage`, File API, Electron API 등을 호출하지 않는다.

모든 플랫폼 기능은 **Interface를 통해 접근**한다.

```text
ProjectRepository
├── WebProjectRepository
├── DesktopProjectRepository
└── CloudProjectRepository
```

UI는 어떤 플랫폼에서 실행되는지 몰라도 된다.

## 저장 방식

| 플랫폼 | 저장 방식 |
|--------|-----------|
| 웹 | IndexedDB 또는 Cloud API |
| 데스크톱 | Local Folder, SQLite |
| Cloud | Remote Storage |

모든 저장 방식은 **동일한 Interface**를 사용한다.

## Electron 도입 시점

아래 기능이 실제로 필요해질 경우 Electron 또는 Tauri를 검토한다.
그 이전에는 React Web만 유지한다.

- 대용량 프로젝트
- 오프라인 사용
- SQLite
- Local MQTT
- Python 실행
- Rust Simulation
- CSV 대량 Import
- Folder Watch
- Enterprise 설치

## Tauri 검토

장기적으로 Rust Simulation Engine이 개발될 경우 Tauri도 좋은 선택이 될 수 있다.
하지만 프로젝트 초기에는 React 개발 속도를 유지하는 것이 더 중요하다.

## Steam 전략

Steam은 OpenFab의 초기 목표가 아니다.

- OpenFab은 **Engineering Tool**이다.
- Steam은 **Game Platform**이다.

따라서 OpenFab 자체를 Steam에 출시하는 것을 목표로 하지 않는다.

### Steam을 고려하는 시점

Campaign, Mission, Economy, Challenge, Tutorial, Progression, Achievement가
모두 완성되어 `Simulation Tool → Simulation Game`으로 발전할 경우에만,
**별도의 게임 프로젝트**로 검토한다.

### 제품 분리

장기적으로 다음과 같이 분리할 수 있다. 둘은 동일한 Simulation Engine을 사용한다.

- **OpenFab Studio** — 엔지니어링 플랫폼
- **Fab Architect (가칭)** — 게임

## 공개 전략

```text
Private Repository
→ 충분한 개발
→ IP 검토
→ 새로운 Public Repository 생성
→ 공개 가능한 코드만 이관
→ Live Demo 제공
→ GitHub Release
```

- 기존 Repository를 Public으로 변경하지 않는다.
- 새로운 Public Repository를 생성한다.

## 배포 단계

```text
Stage 1: Private Web
→ Stage 2: Public Web Demo
→ Stage 3: Desktop Version
→ Stage 4: Enterprise Version
→ Stage 5: Game Version (선택)
```

## 사용자 흐름 (목표)

```text
GitHub → README → Live Demo → Sample Project 실행
→ Rail 생성 → Simulation 실행 → JSON 저장
→ GitHub Release 다운로드 → Desktop 사용 → Enterprise 사용
```

## 성공 기준

OpenFab은 다운로드 수가 아니라 **생태계를 만드는 것**을 목표로 한다.

- 웹에서 즉시 체험 가능하다.
- 설치 없이 FAB를 설계할 수 있다.
- 연구자가 논문에 활용한다.
- 개발자가 Plugin을 만든다.
- Enterprise 고객이 Desktop을 사용한다.
- 동일한 Core Engine으로 Web과 Desktop이 동작한다.

## 최종 목표

OpenFab은 React 프로젝트가 아니다. Electron 프로젝트도 아니다. Steam 게임도 아니다.

OpenFab은 **"Factory Digital Twin Platform"**이며, 다음 관점으로 개발한다.

- **웹**은 첫 번째 사용자 경험
- **Desktop**은 전문 사용자용 확장
- **Cloud**는 협업
- **Enterprise**는 산업 적용
- **Game**은 별도 확장 프로젝트
