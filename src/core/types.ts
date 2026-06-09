/**
 * Universal Blueprint — core types.
 *
 * 핵심 원리: 블루프린트는 "포맷 중립 의도 그래프"다.
 * Doc/PPT/Code/Wireframe/Diagram은 전부 이 그래프의 렌더 출력이며,
 * 우리는 렌더러를 만들지 않는다 — MCP로 소비 모델에 위임한다.
 */

/** 노드의 의미역(semantic role). 출력 포맷이 아니라 "무엇인가"를 표현. */
export type NodeRole =
  | "product" // 루트
  | "goal" // 목표/문제정의
  | "persona" // 사용자/대상
  | "metric" // 성공지표/KPI
  | "requirement" // 요구사항(기능/비기능)
  | "feature" // 기능 단위
  | "flow" // 사용자 흐름(컨테이너)
  | "flow-step" // 흐름 단계
  | "screen" // 화면
  | "screen-element" // 화면 구성요소(버튼/입력/리스트)
  | "component" // 코드 컴포넌트/모듈
  | "data-entity" // 데이터 모델/엔티티
  | "section" // 문서/슬라이드 섹션
  | "claim" // 주장/근거(설득형)
  | "note"; // 자유 메모/제약 (비렌더)

/** 관계(엣지) 타입. traces-to 가 양방향 싱크의 anchor 키. */
export type EdgeType =
  | "parent" // 계층 포함 (트리 골격)
  | "depends-on" // 의존
  | "realizes" // feature 가 requirement 를 실현
  | "supports" // claim 이 goal/metric 을 뒷받침
  | "flows-to" // flow-step 순서
  | "renders-on" // screen-element 가 screen 에 표시
  | "traces-to"; // 산출물↔블루프린트 추적성 (싱크 anchor)

export type NodeStatus = "draft" | "confirmed" | "stub" | "deferred";
export type Priority = "P0" | "P1" | "P2";

/** 노드에 붙는 레퍼런스 자료. 모델에게 "이런 형식으로 만들길 원해"를 시각으로 전달.
 *  UBP 가 *생성*하는 게 아니라 사용자가 외부에서 가져온 자료. */
export type AttachmentKind = "image" | "sketch" | "link" | "file";

export interface Attachment {
  /** 노드 내 고유 ID. */
  id: string;
  kind: AttachmentKind;
  /** 사람이 보는 라벨. */
  title?: string;
  /** kind=link 또는 외부 호스팅 image/file 의 URL. */
  url?: string;
  /** inline 이미지·sketch 의 data URL (base64 또는 SVG). 큰 파일은 url 권장. */
  dataUrl?: string;
  /** MIME 타입 (file 의 경우). */
  mime?: string;
  /** 바이트 크기 (file 의 경우). */
  size?: number;
  /** 노드별 추가 메타 (예: sketch 의 path 데이터, image 의 alt). */
  meta?: Record<string, unknown>;
}

export interface BlueprintNode {
  /** 안정 ID — round-trip 싱크의 키. 절대 재사용 금지. */
  id: string;
  role: NodeRole;
  title: string;
  body?: string;
  status: NodeStatus;
  priority?: Priority;
  /** 결여 슬롯(자동 검출). 예: ["acceptance_criteria"] */
  missing?: string[];
  notes?: string;
  /** role 별 확장 속성. 기재된 값이면 무엇이든 싱크 추적 대상. */
  attrs?: Record<string, unknown>;
  /** 본질 5번: 레퍼런스 첨부. 모델 서빙 시 메타로 포함됨. */
  attachments?: Attachment[];
}

export interface BlueprintEdge {
  from: string; // node id
  to: string; // node id
  type: EdgeType;
  /** 자유 라벨 — 정책 그래프 등에서 의미 보강 (implies/contradicts/supersedes/derives-from 등).
   *  EdgeType 7종 위에 추가 의미. UI 에지에 표시. anchor 매칭엔 영향 없음. */
  label?: string;
}

export interface BlueprintMeta {
  id: string;
  title: string;
  version: string;
  /** 낙관 동시성 키. 변경마다 +1. 미지정 시 store 가 1 로 초기화. */
  rev?: number;
  /** 멀티테넌트 분리 키. 미설정 시 단일 워크스페이스 모드. */
  workspaceId?: string;
}

/** 인증된 액터. confirm·propose 의 actor 파라미터. */
export interface Actor {
  id: string;
  role: ActorRole;
}

export type ActorRole = "owner" | "editor" | "viewer";

/**
 * 권한 정책. 디폴트 정책(미설정 시) 은 기존 동작 보존 — 모든 actor 가 propose/confirm 가능.
 * AuthzPolicy 가 주어진 경우에만 role 기반 거부가 활성화된다.
 */
export interface AuthzPolicy {
  /** confirm 을 허용하는 role 집합. 디폴트는 editor 이상. */
  canConfirm?: ActorRole[];
  /** propose 를 허용하는 role 집합. 디폴트는 viewer 이상(모두). */
  canPropose?: ActorRole[];
  /** restore(스냅샷 롤백) 를 허용하는 role 집합. 디폴트는 owner. */
  canRestore?: ActorRole[];
}

export const DEFAULT_AUTHZ: Required<AuthzPolicy> = {
  canConfirm: ["owner", "editor"],
  canPropose: ["owner", "editor", "viewer"],
  canRestore: ["owner"],
};

export interface Blueprint {
  meta: BlueprintMeta;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
}

/**
 * Anchor — 산출물 요소가 블루프린트의 어디에 대응되는지.
 * 노드 단위뿐 아니라 속성 경로 단위까지 가리킨다 (예: n_btn.attrs.color).
 * granularity 판단의 기반: "변경 대상이 블루프린트에 기재(anchor)되어 있는가?"
 */
export interface Anchor {
  nodeId: string;
  /** 속성 경로. 비우면 노드 전체. 예: "attrs.color", "title" */
  path?: string;
}

export function anchorToString(a: Anchor): string {
  return a.path ? `${a.nodeId}.${a.path}` : a.nodeId;
}
