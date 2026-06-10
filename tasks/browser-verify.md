# Browser verification recipes (agent-browser, session `ubp-debug`)

GUI 회귀 검증. 화이트보드는 사람 저작 도구이므로 MCP-로컬 경로와 직교하나, BP↔Canvas
변환·첨부·anchor 파싱은 자동 eval 로 회귀 고정한다. FS-Access 다이얼로그
(`showSaveFilePicker`/`showDirectoryPicker`)는 user-gesture 필수 → 자동화 불가, 수동 레시피로 분리(통과 위장 금지).

공통 셋업:
```bash
agent-browser --session-name ubp-debug open "file:///C:/Users/PCuser/desktop/claude/ubp/web/whiteboard.html"
```
함수/상태 globals: `BP`(object), `bpToJsonCanvas`/`jsonCanvasToBP`/`loadTemplate`(function).

---

## T3 — JSON Canvas 라운드트립 + properties 매핑  ✅ 2026-06-10

### 3-1. BP→canvas→BP 무손실 (구조 동치)
`bpToJsonCanvas()`는 순수(다운로드 없이 `{nodes,edges}` 반환), `jsonCanvasToBP()`가 역변환.
```bash
agent-browser --session-name ubp-debug eval "
(function(){
  const orig = BP;
  const idSet = new Set(orig.nodes.map(n=>n.id));
  const roleMap = {}; orig.nodes.forEach(n=>roleMap[n.id]=n.role);
  const edgeKey = e=>e.from+'->'+e.to+':'+e.type;
  const origEdges = new Set((orig.edges||[]).map(edgeKey));
  const canvas = bpToJsonCanvas();
  const rt = jsonCanvasToBP(canvas);
  const rtIds = new Set(rt.nodes.map(n=>n.id));
  const idEq = idSet.size===rtIds.size && [...idSet].every(id=>rtIds.has(id));
  const roleEq = rt.nodes.every(n=>roleMap[n.id]===n.role);
  const rtEdges = new Set((rt.edges||[]).map(edgeKey));
  const edgeEq = origEdges.size===rtEdges.size && [...origEdges].every(k=>rtEdges.has(k));
  return JSON.stringify({nodeCount:orig.nodes.length, edgeCount:(orig.edges||[]).length, idEq, roleEq, edgeEq});
})()
"
```
**기대(writing 템플릿 22노드 기준):** `idEq:true, roleEq:true, edgeEq:true` (노드 id-set·role·엣지 from/to/type 보존). 실측: 22노드·36엣지 무손실.

### 3-2. frontmatter/Dataview properties → attrs + section→frame (합성 canvas)
```bash
agent-browser --session-name ubp-debug eval "
(function(){
  const canvas = {
    meta:{title:'Synth'},
    nodes:[
      {id:'n_feat',x:0,y:0,width:300,height:200,text:'회원가입\n---\nrole: feature\npriority: P0\nstatus: confirmed\naudience: 신규유저\n---\n본문 설명'},
      {id:'n_dv',x:0,y:300,width:300,height:200,text:'대시보드\nowner:: 임철\nmetric_target:: 95'},
      {id:'n_sec',x:400,y:0,width:520,height:360,color:'1',text:'Section A'}
    ],
    edges:[{fromNode:'n_feat',toNode:'n_sec',label:'depends-on'}]
  };
  const bp = jsonCanvasToBP(canvas);
  const feat=bp.nodes.find(n=>n.id==='n_feat'), dv=bp.nodes.find(n=>n.id==='n_dv'), sec=bp.nodes.find(n=>n.id==='n_sec');
  return JSON.stringify({
    feat_role:feat.role, feat_priority:feat.priority, feat_status:feat.status,
    feat_audience:feat.attrs&&feat.attrs.audience, feat_body:feat.body,
    feat_no_priority_in_attrs:!(feat.attrs&&'priority' in feat.attrs),
    dv_owner:dv.attrs&&dv.attrs.owner, dv_metric:dv.attrs&&dv.attrs.metric_target,
    sec_role:sec.role, sec_frame:sec.attrs&&sec.attrs.frame
  });
})()
"
```
**기대:** `feat_role:"feature"`(frontmatter role override), `feat_priority:"P0"`·`feat_status:"confirmed"`(top-level 승격), `feat_no_priority_in_attrs:true`(승격 후 attrs에서 제거), `feat_audience:"신규유저"`·`feat_body:"본문 설명"`, `dv_owner:"임철"`·`dv_metric:95`(Dataview `key::` + 숫자 coerce), `sec_role:"section"`(color "1"), `sec_frame:{width:520,height:360}`(canvas w/h → attrs.frame).

---

## T4 — 첨부 저장 4모드 ref·다운그레이드  ✅ 2026-06-10

자동 검증 대상(다이얼로그/네트워크 불필요): inline base64 보존, idb `@idb:<id>` ref + round-trip,
url 외부 ref, >10MB inline→idb 자동 다운그레이드. `addAttachment` 를 일시 stub 해 BP 비오염.
```bash
agent-browser --session-name ubp-debug eval "
(async function(){
  const snap={mode:UI.defaultAttStorage,thr:UI.inlineThreshold,bh:UI.backendHint,add:window.addAttachment};
  const out={};
  try{
    UI.defaultAttStorage='inline'; UI.inlineThreshold=256;
    const a=await persistAttachment({id:'a_t_inl',kind:'image',dataUrl:'data:image/png;base64,INLINE',mime:'image/png',size:100},{size:100});
    out.inline_keepsDataUrl=a.dataUrl==='data:image/png;base64,INLINE'&&!(''+(a.url||'')).startsWith('@idb:');
    UI.defaultAttStorage='indexeddb';
    const b=await persistAttachment({id:'a_t_idb',kind:'image',dataUrl:'data:image/png;base64,IDBPAYLOAD',mime:'image/png',size:300000},{size:300000});
    out.idb_ref=b.url==='@idb:a_t_idb'&&b.dataUrl===undefined&&b.meta&&b.meta.storage==='indexeddb';
    out.idb_roundtrip=(await resolveAttachmentSrc(b))==='data:image/png;base64,IDBPAYLOAD';
    const c=await persistAttachment({id:'a_t_url',kind:'link',url:'https://example.com/x.png',title:'x'},null);
    out.url_ref=c.url==='https://example.com/x.png'&&c.dataUrl===undefined;
    UI.backendHint='filesystem'; UI.defaultAttStorage='inline';
    let captured=null; window.addAttachment=(att)=>{captured=att;};
    await ingestFileAsAttachment(new File([new Uint8Array(11*1024*1024)],'big.png',{type:'image/png'}));
    out.downgrade_toIdb=!!captured&&(''+(captured.url||'')).startsWith('@idb:')&&captured.dataUrl===undefined&&captured.meta&&captured.meta.storage==='indexeddb';
    try{await idbDel('a_t_idb');}catch(e){} if(captured&&captured.url){try{await idbDel(captured.url.slice(5));}catch(e){}}
  }finally{ UI.defaultAttStorage=snap.mode;UI.inlineThreshold=snap.thr;UI.backendHint=snap.bh;window.addAttachment=snap.add; }
  return JSON.stringify(out);
})()
"
```
**기대:** 5개 전부 `true`. (inlineThreshold 기본 256KB → B는 file.size 300KB로 idb 분기 트리거. 다운그레이드는 `isLocal && size>10MB && mode==='inline'` 조건.)

### 수동 레시피 (자동화 불가 — 통과 위장 금지)
- **local-fs (`@fs:`)**: `UI.defaultAttStorage='local-fs'` 후 파일 첨부 → `showDirectoryPicker` user-gesture 다이얼로그 필수. 디렉토리 연결 후 `@fs:<id>_<name>` ref + `_fsDirHandle.getFileHandle` 로 resolve. 페이지 새로고침 시 handle 휘발 → 재선택 필요.
- **Supabase Storage**: `UI.supabaseUrl`/`supabaseAnonKey`/`supabaseBucket` 설정 + 실 네트워크 POST. public URL ref 반환. 자격증명·네트워크 의존 → 수동.

## T5 — anchor scan 파싱 + UI 폴리시 회귀  ✅ 2026-06-10

### 5-1. anchor 마커 파싱 + 템플릿 노드수 회귀 (자동)
`scanAnchorsInBrowser` 의 디렉토리 픽(`showDirectoryPicker`)은 자동화 불가 → 마커 추출
정규식(`ANCHOR_MARKER_RE`) 만 fixture 로 검증. 템플릿은 `TEMPLATES[k]()` 팩토리를 직접 호출해
노드수만 카운트(BP 비오염 — `loadTemplate` 미사용).
```bash
agent-browser --session-name ubp-debug eval "
(function(){
  const fixture=['// @ubp-anchor: #n_demo','x=1; /* @ubp-anchor:#n_feat.acceptance_criteria */','#  @ubp-anchor : #n_root','plain line, no marker'];
  const hits=[]; fixture.forEach((ln,i)=>{const r=new RegExp(ANCHOR_MARKER_RE.source,'g');let m;while((m=r.exec(ln))){hits.push({line:i+1,nodeId:m[1],path:m[2]?m[2].slice(1):null});}});
  const anchorOk=hits.length===3&&hits[0].nodeId==='n_demo'&&hits[0].path===null&&hits[1].nodeId==='n_feat'&&hits[1].path==='acceptance_criteria'&&hits[2].nodeId==='n_root'&&hits[2].path===null;
  const counts={}; ['writing','novel','essay','sns'].forEach(k=>counts[k]=TEMPLATES[k]().nodes.length);
  const countOk=counts.writing===11&&counts.novel===22&&counts.essay===14&&counts.sns===17;
  return JSON.stringify({anchorOk,countOk,counts});
})()
"
```
**기대:** `anchorOk:true`(3건, nodeId+`.path` 추출), `countOk:true`, `counts:{writing:11,novel:22,essay:14,sns:17}`.

### 5-2. collapse 핸들 geometry (자동)
```bash
agent-browser --session-name ubp-debug eval "
(function(){
  const lp=document.getElementById('left-panel'),rp=document.getElementById('right-panel');
  const lh=document.querySelector('#left-panel .panel-toggle-handle'),rh=document.querySelector('#right-panel .panel-toggle-handle');
  const lb=lh.getBoundingClientRect(),rb=rh.getBoundingClientRect(),lpb=lp.getBoundingClientRect(),rpb=rp.getBoundingClientRect();
  const leftGap=Math.abs(lb.right-lpb.right),rightGap=Math.abs(rb.left-rpb.left);
  return JSON.stringify({size:{w:Math.round(lb.width),h:Math.round(lb.height)},leftGap:+leftGap.toFixed(2),rightGap:+rightGap.toFixed(2),flush:leftGap<1.5&&rightGap<1.5,opacity:getComputedStyle(lh).opacity});
})()
"
```
**기대:** `size:{w:14,h:32}`, `leftGap`/`rightGap` < 1.5(실측 0.8px), `flush:true`, `opacity:"0"`(hover 전 숨김). 핸들 outer(canvas-facing) edge 가 패널 inner 테두리에 flush.
스크린샷: `tasks/t5-collapse-handle.png` (left-panel hover 상태). ※14px 핸들은 풀윈도 줌에서 시각적으로 작음 — flush/opacity 의 권위 있는 증거는 위 geometry eval.

### 수동 레시피 (자동화 불가)
- **anchor 디렉토리 스캔**: 우상단 "Anchor" 버튼 → `showDirectoryPicker` (user-gesture). 프로젝트 폴더 선택 시 `// @ubp-anchor: #nodeId` 마커 → file 노드 + `traces-to` propose 큐 (Confirm Gate). `ANCHOR_SCAN_EXTS`(.ts/.py/.md 등) + `ANCHOR_SCAN_IGNORE`(node_modules/.git/dist…) 적용, 파일당 2MB 상한.

---

## TB — 옵션2 FileStore (웹↔MCP `.blueprint/bp.json` 공유)  ✅ 2026-06-10

### TB-auto. FileStore 로직 (mock FS 핸들로 결정적 검증)
`showDirectoryPicker` 다이얼로그는 자동화 불가 → makeFileStore 가 쓰는 API 표면
(`getFileHandle({create})`·`getFile().text()`·`createWritable({keepExistingData})`→`write/seek/close`·
`getDirectoryHandle`·`entries()`·`removeEntry`)만 in-memory mock 으로 구현해 load/save/rev-lock/pull 검증.
재현 스크립트는 git 히스토리(이 커밋 메시지) 참조. **실측 결과:**
```json
{"l0_empty":true,"l1_rev":1,"l1_pos":10,"l2_rev":2,"l2_nodes":2,
 "snap_files":["bp.json","pos.json","audit.jsonl","r00001-5c4c1e9a44b7.json"],
 "audit_lines":2,"conflictFired":true,"afterConflict_rev":9,"pulled_rev":9}
```
- 빈 폴더 → `bp:null`. save→load 라운드트립 무손실(rev·pos 사이드카).
- `bp.json` 은 Blueprint 객체만(MCP 호환). 좌표는 `pos.json` 분리. `snapshots/r#####-<sha>.json` + `audit.jsonl` append.
- **rev-lock**: 디스크가 외부에서 rev9 로 바뀐 뒤 save → `onFileConflict` 발화, 디스크 rev9 유지(침묵 덮어쓰기 0). ← 1급 요구.
- **pull()**: 외부 rev9 변경 감지 후 반환.

### TB-mcp. MCP 외부 재읽기 (TB3, node e2e)
`dist/store.js` 로 store 생성 → 외부에서 파일을 rev5+노드로 덮어쓰고 `utimes` 로 mtime 미래화 →
`get()`/`propose()`/`confirm()` 검증. **실측:** `get().rev=5`·`n_ext` 반영, `propose.baseRev=5`,
`confirm.rev=6` (낙관락이 외부 writer 도 포착). `npm run build` EXIT0 + `node smoke.mjs` 24/24.

### 수동 레시피 (자동화 불가 — 통과 위장 금지)
1. **폴더 연결**: 콘솔/배지에서 `connectProjectFolder()` → `showDirectoryPicker` (user-gesture)로 프로젝트 루트 선택.
   `.blueprint/` 자동 생성, `bp.json`/`pos.json` 쓰기. 빈 폴더면 현재 작업 시드, 기존 BP 있으면 로드(`syncAfterConnect`).
2. **핸들 영속 + 권한 재확보**: 새로고침 → `restoreFileStoreFromIdb()` 가 IndexedDB(`ubp_fs_handles`)에서 루트 핸들 복원.
   `queryPermission` granted 면 자동 FILE 복원, 아니면 `_fileNeedsReconnect=true`(배지가 `reacquireFilePermission()` 유도).
3. **웹↔MCP 양방향**: `.mcp.json` 의 `UBP_STORE` 를 연결 폴더의 `.blueprint/bp.json` 으로 맞춤. 웹 저장 → MCP `get` 이
   재읽기. MCP `confirm` → 웹 `_filePollTick`(4초/focus/visibility) 이 `pull` 로 반영. 미저장 편집 중이면 클로버 보류.
4. **rev 충돌**: 양쪽이 같은 base 에서 동시 편집 → 웹 save 시 `onFileConflict`(미주입 시 toast)로 보류. 새로고침 재동기화.
   (rev 번호 충돌 — 양측이 같은 rev 번호에 다른 내용 — 은 알려진 한계. 머지 다이얼로그는 TD3.)

---

## TD — 저장 위치 배지·패널·분기 UX (혼란 방지)  ✅ 2026-06-10

### TD-auto. 배지 3-상태 + 패널 + 분기 다이얼로그 (자동)
```bash
agent-browser --session-name ubp-debug eval "
(function(){
  const out={};
  openStorePanel();
  const pb=document.getElementById('store-panel-body').innerHTML;
  out.panel_open=document.getElementById('store-panel').open;
  out.panel_has_connectBtn=pb.includes('폴더 연결'); out.panel_has_supaBtn=pb.includes('Supabase 설정');
  document.getElementById('store-panel').close();
  const saved=activeStore;
  activeStore=makeFileStore({},'MyProj'); updateStoreBadge();
  const b=document.getElementById('store-badge');
  out.file_class=b.className; out.file_icon=b.firstChild.nodeValue.trim();
  _fileNeedsReconnect=true; updateStoreBadge(); out.reconnect_class=b.className; _fileNeedsReconnect=false;
  activeStore=saved; updateStoreBadge(); out.restored_class=b.className;
  showDivergenceDialog({diskRev:9,localRev:3,disk:{meta:{rev:9}}});
  out.diverge_body=document.getElementById('store-divergence-body').innerHTML.includes('rev 9');
  resolveDivergence('cancel'); out.diverge_closed=!document.getElementById('store-divergence').open;
  return JSON.stringify(out);
})()
"
```
**기대:** `panel_open:true`, `panel_has_connectBtn/supaBtn:true`, `file_class:"store-badge tier-file"`·`file_icon:"🔵"`,
`reconnect_class` 에 `needs-attn` 포함, `restored_class:"store-badge tier-local"`, `diverge_body:true`, `diverge_closed:true`.
스크린샷: `tasks/td-store-badge.png` (헤더 "⚪ 이 브라우저만" 배지 — rev pill 옆).

### 수동 레시피 (자동화 불가)
- **배지→폴더 연결→🔵 전환**: 배지 클릭 → 패널 "폴더 연결" → `showDirectoryPicker`(제스처) → 배지가 🔵 로컬 파일로 갱신, label 에 폴더명.
- **충돌 시 분기**: 웹·MCP 동시 편집으로 rev 어긋남 → 웹 저장 시 분기 다이얼로그 → "디스크 불러오기"/"내 버전 덮어쓰기"/"취소" 중 사용자 선택(침묵 덮어쓰기 0).
- **해제 마이그레이션**: 패널 "폴더 연결 해제" → LocalStore 전환, 현재 BP 가 localStorage 에도 시드됨(파일은 그대로). 배지 ⚪ 복귀.

---

## TC — 옵션3 CloudStore (웹↔MCP Supabase 공유)  ✅ 2026-06-10

### TC-auto. CloudStore 로직 (mock Supabase fetch 로 결정적 검증)
실 Supabase 자격증명/네트워크 없이 `window.fetch` 를 in-memory `blueprints` 단일 행 + `bp_bump_rev`
트리거 근사(bp 변경 시 rev++)·조건부 PATCH(`rev=eq.X` 불일치 시 0행)로 스텁해 makeCloudStore
load/save/rev-lock/pull 검증. 재현 스크립트는 git 히스토리(이 커밋) 참조. **실측:**
```json
{"insert_rev":1,"conflictFired":true,"noOverwrite":true,"forceMine_rev":8,"forceMine_nodes":9}
```
- 빈 테이블 → `bp:null`. 최초 save→insert(rev1), load 라운드트립 무손실(bp+pos 사이드카 컬럼).
- 정상 save(bp 변경) → 트리거 rev++ → lastRev 동기.
- **rev-lock**: 외부가 rev 를 7 로 바꾼 뒤 save → `onCloudConflict`(=showDivergenceDialog, tier=cloud) 발화,
  원격 rev7 유지(침묵 덮어쓰기 0). ← 1급 요구. force-mine(`_setLastDiskRev(7)`) 후 save 는 통과(rev8).
- **pull()**: 외부 rev 변경 감지 후 반환, 변경 없으면 null.

### TC-ui. CLOUD 티어 배지·패널·분기 (자동)
**실측:** `resolve_cloud:true`(Supabase 설정 → CLOUD 우선), `badge_class:"store-badge tier-cloud"`·icon `🟢`·
label `"클라우드 · wsZ"`, 패널에 "클라우드 연결 해제" 버튼, 분기 다이얼로그 클라우드 문구(`rev 12`,
`.blueprint/bp.json` 미포함). 스크린샷: `tasks/tc-cloud-badge.png`.

### TC-mcp. MCP createStorage 전환 (무회귀)
`src/mcp-server.ts` 가 `new BlueprintStore` → `await createStorage(ubpSelf)` (top-level await).
`UBP_BACKEND` 미설정 → filesystem(UBP_STORE 보존). **실측:** MCP 부팅 시
`[ubp] storage backend: filesystem` 로그, `npm run build` EXIT0 + `node smoke.mjs` 24/24.

### 수동 레시피 (자동화 불가 — 통과 위장 금지)
1. **스키마 적용**: `src/server/storage/supabase.sql` 을 Supabase SQL editor 에 붙여넣기(`blueprints.pos jsonb` 컬럼 포함).
2. **웹 CLOUD 활성**: 설정 → 저장·백엔드 → Supabase URL/anon key + 워크스페이스 ID 입력 → 새로고침 시
   `activateCloudStore()` 자동 활성(배지 🟢). 또는 배지 패널 "클라우드로 전환".
3. **웹↔MCP 양방향**: MCP 를 `UBP_BACKEND=supabase` + 동일 `SUPABASE_URL`/`SUPABASE_ANON_KEY`(또는 service)
   + **`UBP_WORKSPACE_ID` = 웹 워크스페이스 ID** 로 기동. 웹 저장 → MCP `get` 반영, MCP `confirm` → 웹
   Realtime(postgres_changes) 또는 8초 폴링이 `pull` 로 반영.
4. **rev 충돌**: 양측 동시 편집 → 웹 save 시 조건부 PATCH 0행 → 분기 다이얼로그(클라우드/내 버전/취소).
   Realtime websocket 은 anon 키·RLS·`supabase_realtime` publication 의존 → 실 네트워크 수동 확인.
