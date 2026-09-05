# FAB Layout Authoring Rules

이 문서는 특정 현장 맵을 재현하지 않고 OpenFab의 1 m directed TileMap 문법으로 정적
반도체 FAB 물류 레이아웃을 생성하기 위한 제품 규칙이다. 여기의 수치는 산업 표준이나
제3자 인증값이 아니라 OpenFab이 독립적으로 정의한 정규화 profile이다.

> 상태 구분: 공개 hierarchy, directed topology, exact ownership, IP, atomic Worker/history 규칙은
> 현재 불변조건이다. Profile wizard, layout-block/Bay-packing controls, exact prepared
> `OPENFAB VERIFIED` evidence UI는 현재 구현되어 있다. Contextual terminal actions는 roadmap의
> 다음 **target UX**이며 아직 출시되지 않았다.

> IP 경계: `docs/agent-working-principles.md` 4장을 따른다. 로컬 레퍼런스는 공통 계층과
> 비율을 교차 확인하는 데만 쓸 수 있다. 원본 좌표, 식별자, 행, source code, 자산, 정확한
> 레이아웃 지문은 저장하거나 재현하지 않는다. 외부 맵의 `bay` label을 OpenFab의
> 건축적 Bay와 동일하다고 가정하지 않는다.

## 1. 공개 계층

```text
Fab
├─ Perimeter circulation (optional physical role)
├─ Layout Block × N (generator-only grouping; not an organization record)
│  ├─ Distributor / interbay backbone (physical role)
│  └─ Bay Bank
│     └─ Bay
│        ├─ enclosing Bay circulation shell
│        ├─ Process Lane / Process Loop × N
│        └─ typed branch / merge gateways
└─ typed inter-block circulation connector (physical role)

Fab root ↔ typed Fab-to-Fab bridge ↔ separate Fab root (future explicit command)
```

- **Process Lane / Process Loop**: 장비 포트가 접근하는 가장 작은 반복 물류 회로.
- **Bay**: 하나 이상의 Process Loop, 이를 감싸는 circulation shell, 외부 gateway를 함께
  소유하는 의미 단위.
- **Bay Bank**: 같은 distributor/backbone을 공유하는 Bay 묶음.
- **Fab**: Bank와 상위 circulation을 하나의 방향성 물류망으로 묶은 전체.
- **Layout Block**: generator가 여러 Bank를 배치하는 물리 grouping. 현재 organization DAG에
  직렬화하거나 독립 ownership을 부여하지 않는다. 별도 Fab root 사이의 bridge와 구분한다.
- **Spine, perimeter, bypass, return path**는 독립 제품 종류가 아니라 위 계층 안에서 맡는
  물리적 역할 또는 문맥 명령이다.

직렬화된 organization DAG와 정확한 rail-edge ownership이 의미의 source of truth다.
Canvas, 3D view, minimap, thumbnail은 모두 이 authored truth의 파생 consumer다.

## 2. 사용자가 조정하는 규격

새 FAB generator는 낮은 수준의 선로 길이 문법 대신 다음 설계 의도를 받는다.

| Parameter | OpenFab profile | 의미 |
|---|---:|---|
| Process Loop long axis | 36 / 48 / 56 m | 장비 열을 따라 반복되는 주행 길이 family |
| Process Loop lane-pair width | 4 m default | 한 쌍의 평행 one-way lane과 turnback envelope |
| Process Loop center pitch | 12 / 14 / 16 m | 인접 반복 회로 중심 간격; compact / standard / wide |
| Process Loops per Bank | 12 / 18 / 24 | Bank가 공유 distributor에 수용하는 반복 단위 |
| Bay packing policy | Single / Twin / balanced mix | Process Loop를 1-loop/2-loop Bay shell로 묶는 규칙 |
| Banks per Layout Block | 1 / 2 / 3 | 한 Layout Block 안의 Bank 수 |
| Layout Blocks per Fab | 1 / 2 / 3 | 직렬화 role이 아닌 generator 배치 grouping |

이 값들은 여러 topology family에서 반복 사용하기 쉽도록 1 m grid에 새로 반올림한
OpenFab-owned 선택군이다. 참조 맵의 정확한 수치나 배치를 복제한 값이 아니다.

Bay packing은 목표 Process Loop 수를 정확히 보존하며 각 loop를 정확히 한 Bay에 넣는다.
Single은 Bay당 하나, Twin은 Bay당 둘, balanced mix는 버전된 deterministic sequence로 묶는다.
Review는 파생 Bay 수, Process Loop 수, gateway 수를 따로 보여준다. Bay envelope와 Fab
footprint도 위 선택의 **파생값**이다. 기존 preset의 `frontage`, `depth`, `pitch` 이름은
Process Loop, Bay shell, Bank pitch를 혼용하므로 새 UI에서 그대로 쓰지 않는다. 직렬화된
기존 프로젝트와 compile API는 migration이 준비될 때까지 호환성을 유지한다.

## 3. Compiler가 숨기는 규격

다음 항목은 사용자가 motif 카드에서 고르는 값이 아니다.

- 직선 edge subdivision cadence
- curve의 실제 path length
- branch/merge cell grammar, support straight, typed gateway count
- curve radius와 clearance profile
- checksum, ownership range, Worker patch cursor
- physical path, clearance, port-slot compilation

Generator는 사용자의 `loop length / pitch / count / circulation policy`를 받아 위 세부사항을
결정적으로 파생해야 한다. 내부 edge cadence를 UI에 노출하거나 authored intent로 저장하지
않는다.

현재 semantic Production Bay profile은 정확히 네 개의 typed branch/merge gateway와 R500
곡선 문법을 compiler에서 파생한다. 이는 사용자 조정 규격이나 외부 산업 인증값이 아니다.
R600 복합 repair geometry가 일부 저수준 도구에 존재하더라도, selectable FAB clearance
profile은 아직 구현되지 않았다. 향후 radius profile은 core geometry, clearance, persistence,
Worker certification, migration 계약을 함께 갖춘 뒤에만 공개할 수 있다.

## 4. Topology 불변 조건

완성 preset과 semantic assembly는 모두 다음을 만족해야 한다.

1. 전체 directed rail graph가 하나의 물리 component이자 하나의 directed SCC다.
2. 모든 Bay gateway에서 모든 다른 gateway로 합법적인 directed route가 존재한다.
3. branch `1→2`와 merge `2→1`가 방향·support·clearance가 맞는 pair로 구성된다.
4. 완성 FAB에는 정상 운행용 open terminal이 없다.
5. 각 rail edge의 의미 ownership이 정확히 하나의 canonical organization에 귀속된다.
6. port는 compiled physical rail에 정확히 attachment되고 장비 service direction을 만족한다.
7. authored mutation 하나는 history entry 하나와 typed Worker patch 하나로 원자적으로
   commit, undo, redo된다.

겉으로 닫힌 사각형처럼 보이는 것은 충분하지 않다. SCC, gateway reachability, physical
curve, clearance, port serviceability가 모두 통과해야 한다.

### 4.1 계층 분리와 삭제

`Detach`는 선택한 semantic 조직과 부모 사이의 관계와 그 관계를 구성하는 정확히 인증된
connector cut만 제거하고 선택 조직의 전체 `EFFECTIVE` subtree를 보존한다. `Delete`만 선택
조직의 배타적 소유 subtree와 그 Rail/Port/equipment 의존성을 제거할 수 있다. 두 명령은 같은
삭제 집합이나 확인 문구를 공유하지 않는다.

- attached Bay Bank는 정확히 하나의 root Fab 부모를 가질 때만 Detach 또는 Delete 후보가 된다.
- detached Bay Bank는 Delete만 가능하다.
- root Fab은 부모 관계가 없으므로 Detach할 수 없고, Delete만 별도 인증 대상이 된다.
- Fab-to-Fab bridge는 미래의 explicit typed command이며 현재 Fab Detach로 추측하지 않는다.
- 허용된 관계 cut 밖의 organization, rail module, switch, Port, equipment ownership/reference가
  영향 범위에 들어오거나 완전한 cut이 둘 이상이면 자동 cascade하지 않고 차단한다.
- runtime connector receipt, 이름, generic `kind`, 선택 bounds는 native reopen 뒤의 관계 identity나
  삭제 권한이 아니다. relationship schema/producer 활성화 뒤 새로 authored되는 assembly 관계는
  versioned typed record로 명시하고,
  현재 DAG/Rail/exact ownership에서는 그 관계의 최신 유효성과 안전한 제거 가능성을 별도로
  다시 증명해야 한다.
- organization DAG는 logical hierarchy truth다. typed relationship record는 모든 DAG edge를
  복제하지 않고, 하나의 current parent 아래에서 명시적으로 authored된 physical relationship만
  인증한다. generic reparent나 legacy migration으로 만들어진 record 없는 DAG edge는 유효하지만
  unmanaged이며 자동 Detach geometry를 부여하지 않는다. V1 record는 ordered participant와 그중
  실제로 관리하는 sorted child subset을 분리하고, authored review policy를 현재 detachability나
  삭제 권한으로 캐시하지 않는다. 정확한 계약은
  `docs/static-fab-assembly-relationship-model-v1.md`에 고정한다.
- target/parent module이 같은 vertex에 닿는 raw pair나 그 parent weak component는 connector
  terminal/corridor 증명이 아니다. 한 junction에서 여러 module candidate가 생길 수 있으므로
  directed branch/merge seam과 양쪽 semantic endpoint를 별도로 인증한다.
- 모든 parent component가 정확히 하나의 branch-to-merge path로 선택 Bank와 canonical sibling
  Bank를 잇고 selected incidence를 빠짐없이 소비하면 구조적 complete cut으로 기록할 수 있다.
  이 결과만으로는 runtime Connector purpose/provenance나 제거 후 closure가 증명되지 않으므로
  mutation, Worker, history 또는 UI Apply 권한이 아니다.
- complete cut은 현재 source에서 다시 해석한 뒤에만 private clone에서 prospective 평가한다.
  cut edge만 정확히 제거하고 non-cut edge를 모두 보존하며, post-cut whole-module ownership을
  전부 재구성한다. mixed-owner/owned-unowned 재결합, `100,000`개 post-cut module 초과, 열린
  authored/physical component, selected 또는 retained region의 불완전 module coverage, `+1`이
  아닌 authored/physical component delta, 비어 있는 retained Fab direct membership, 깨진
  raw/compiled Port attachment, cursor 변화는 모두 차단한다.
- prospective 성공도 `PROSPECTIVE_BANK_DETACH_ONLY / NO_MUTATION_AUTHORITY` 증거일 뿐이다.
  runtime purpose/provenance를 구조에서 추측하지 않는다. OpenFab은 structural equivalence를
  relationship identity로 삼지 않고 versioned persisted relationship domain을 사용한다. 다만
  pairwise Connector와 branched production Fab을 모두 표현하는 exact footprint 계약은 V1 model로
  고정됐고, production type, migration, Worker/history/native-reopen evidence가 끝나기 전에는
  mutation/UI Apply 경계를 만들지 않는다.
- review/cancel은 project-neutral이고, Apply는 명시적이며, Apply/Undo/Redo는 각각 한 atomic
  history event와 한 typed Worker patch로 처리한다.

세부 action matrix, Worker/adoption, focus, native reopen, scale 기준은
`docs/semantic-bank-fab-detach-delete-audit.md`에 고정한다. 해당 증거가 완료되기 전에는
Bank/Fab destructive action을 UI에 노출하지 않는다.

## 5. 생성 archetype

Archetype은 카드 조각 모음이 아니라 위 규격을 배치하는 generator policy다.

- **Single Block / Parallel Banks**: 한 block 안에서 Bank를 나란히 두고 공통 distributor와
  circulation으로 묶는다.
- **Central Distributor**: 양쪽 Bank가 중앙 interbay backbone을 공유한다.
- **Paired Circulation**: opposite-flow circulation pair가 Bank gateway를 수용한다.
- **Multi Block**: 한 Fab root 안에서 각 generator-only layout block이 내부적으로 완결되고
  typed inter-block circulation corridor로 연결된다. 별도 Fab root 연결은 미래의 explicit
  Fab-to-Fab bridge command다.
- **Perimeter Redundancy**: 처리량·우회 요구가 있을 때만 outer alternate route를 추가한다.

`Process Loop`, `Spine`, `Circulation`, `Open End`는 archetype chooser의 동급 항목이 아니다.
Process Loop는 반복 내부 단위, spine/circulation은 generator가 선택하는 structural role,
open end는 미완성 상태 또는 repair context다.

## 6. 호환성 표시

`CERTIFIED`처럼 범위를 알 수 없는 단일 badge를 쓰지 않는다. UI는 어떤 gate를 통과했는지
분리해서 보여준다.

- **GEOMETRY**: grid, curve radius, straight support, clearance
- **DIRECTED TOPOLOGY**: SCC, reachability, branch/merge orientation, open terminals
- **ORGANIZATION**: Fab → Bank → Bay → Process Loop DAG와 exact edge ownership
- **PORT SERVICE**: station attachment, service direction, equipment clearance
- **OPERATIONAL WARNING**: merge concentration, alternate-route availability, future simulation input

`OPENFAB VERIFIED`는 위 목록 중 실제로 통과한 범위를 함께 표시할 때만 사용한다. 이는 SEMI나
다른 외부 기관의 형상 인증을 뜻하지 않는다.

## 7. 저작 흐름

1. `New Fab`에서 layout block, Bank, Process Loop target, Bay packing, length/pitch,
   circulation policy를 고른다.
2. generator가 complete Fab를 만들고 topology/physical/organization gate를 통과시킨다.
3. 사용자는 Fab/Bank/Bay를 선택해 duplicate, arrange, connect한다.
4. Bay의 내부 Process Loop와 port를 문맥 편집한다.
5. 특수 구간만 직접 Rail Construction으로 수정한다.
6. Checks에서 geometry, topology, organization, port readiness를 다시 확인한다.

Advanced rail motifs는 호환성과 repair를 위해 보존하되, complete Fab/Bay를 만드는 주 UX로
노출하지 않는다. `Open End`는 별도 카테고리가 아니라 열린 terminal 선택 시의
`Close / Turn Around / Continue` 문맥 action으로 제공한다.

이 문서는 `docs/fab-layout-grammar.md`와 `docs/paired-circulation-fab-grammar.md`의 현재
topology grammar를 대체하지 않고, 그 위의 제품 profile/UX를 제한한다. 명시적 core migration
전에는 두 grammar 문서의 directed TileMap 계약과 현재 compiler 불변조건이 우선한다.

## 8. 금지

- 특정 현장 `.map`의 좌표, block 수열, Bay 배치, ID, naming을 재현하지 않는다.
- proprietary source code, comments, algorithms, assets를 복사하거나 번역해 넣지 않는다.
- 외부 rail grouping label을 OpenFab organization으로 무비판적으로 변환하지 않는다.
- 실제 운영 recipe, dwell, capacity를 generic preset에 하드코딩하지 않는다.
- UI thumbnail 또는 renderer object를 editable source of truth로 사용하지 않는다.

관련: `docs/static-fab-ui-ux-redesign.md`, `docs/static-fab-authoring-roadmap.md`,
`docs/rail-construction-v3.md`.
