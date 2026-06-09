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
