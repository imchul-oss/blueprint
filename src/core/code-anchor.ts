import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

/**
 * Code-anchor 스캐너.
 *
 * 코드 / 마크다운 파일 안의 `@ubp-anchor: #nodeId[.path]` 마커를 찾아
 * 블루프린트 노드와 코드 위치 사이의 traces-to 인덱스를 만든다.
 *
 * vibecoder JTBD: 코드 변경이 곧 BP 갱신 제안이 되도록 — 코드측 진입점.
 *
 * 지원 마커 표기:
 *   // @ubp-anchor: #n_login
 *   # @ubp-anchor: #n_login.attrs.acceptance_criteria
 *   <!-- @ubp-anchor: #n_login -->
 *   /* @ubp-anchor: #n_login *\/
 */

export interface CodeAnchorHit {
  file: string; // 디렉토리 기준 상대 경로
  line: number; // 1-based
  nodeId: string;
  path?: string; // attrs.acceptance_criteria 등 — 비우면 노드 전체
  raw: string; // 매칭된 원문 마커
}

export interface ScanOptions {
  /** 기본 확장자: .ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.md */
  exts?: string[];
  /** 디렉토리 이름 무시 (디폴트: node_modules, .git, dist, build, .next) */
  ignore?: string[];
  /** 최대 파일 크기(bytes). 디폴트 1MB. */
  maxFileSize?: number;
}

const DEFAULT_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".md"];
const DEFAULT_IGNORE = ["node_modules", ".git", "dist", "build", ".next", ".blueprint"];
const DEFAULT_MAX = 1_000_000;

// `@ubp-anchor: #n_xxx` 또는 `#n_xxx.path.sub`
// 매칭 후 끝 부분의 `-->`, `*/` 등은 nodeId 에 포함되지 않도록 path 패턴을 보수적으로.
const MARKER_RE = /@ubp-anchor\s*:\s*#([A-Za-z_][\w-]*)(\.[A-Za-z_][\w.\[\]]*)?/g;

function walk(dir: string, ignore: Set<string>, exts: Set<string>, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (ignore.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, ignore, exts, out);
    else if (st.isFile() && exts.has(extname(name).toLowerCase())) out.push(full);
  }
}

/** root 아래 코드/마크다운에서 모든 anchor 마커를 추출. */
export function scanCodeAnchors(root: string, opts: ScanOptions = {}): CodeAnchorHit[] {
  const exts = new Set((opts.exts ?? DEFAULT_EXTS).map((e) => e.toLowerCase()));
  const ignore = new Set(opts.ignore ?? DEFAULT_IGNORE);
  const maxSize = opts.maxFileSize ?? DEFAULT_MAX;

  const files: string[] = [];
  walk(root, ignore, exts, files);

  const hits: CodeAnchorHit[] = [];
  for (const file of files) {
    let st;
    try {
      st = statSync(file);
    } catch {
      continue;
    }
    if (st.size > maxSize) continue;

    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const rel = relative(root, file).replace(/\\/g, "/");
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 새 RegExp 인스턴스로 lastIndex 초기화
      const re = new RegExp(MARKER_RE.source, MARKER_RE.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const nodeId = m[1];
        const path = m[2] ? m[2].slice(1) : undefined; // 앞쪽 점 제거
        hits.push({
          file: rel,
          line: i + 1,
          nodeId,
          path,
          raw: m[0],
        });
      }
    }
  }
  return hits;
}

/** 사람이 읽는 요약. */
export function formatAnchorHits(hits: CodeAnchorHit[]): string {
  if (hits.length === 0) return "anchor 0건.";
  const byNode = new Map<string, CodeAnchorHit[]>();
  for (const h of hits) {
    const arr = byNode.get(h.nodeId) ?? [];
    arr.push(h);
    byNode.set(h.nodeId, arr);
  }
  const out: string[] = [`총 ${hits.length}건 (${byNode.size} 노드)`];
  for (const [nodeId, arr] of byNode) {
    out.push(`  #${nodeId}: ${arr.length}건`);
    for (const h of arr.slice(0, 5)) {
      const tag = h.path ? `.${h.path}` : "";
      out.push(`    - ${h.file}:${h.line}${tag}`);
    }
    if (arr.length > 5) out.push(`    … +${arr.length - 5}`);
  }
  return out.join("\n");
}
