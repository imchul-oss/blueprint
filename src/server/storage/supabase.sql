-- UBP — Supabase / Postgres 스키마 + RLS 정책
-- 적용: Supabase SQL editor 에 붙여넣거나 supabase db push.
-- 자체 호스팅 Postgres 에선 RLS 부분 생략 가능 (application-level authz 사용).

-- ============ Extensions ============
create extension if not exists "uuid-ossp";

-- ============ Tables ============

-- workspaces: 격리 단위
create table if not exists workspaces (
  id          text primary key,
  name        text not null,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- memberships: 권한 매트릭스 (owner/editor/viewer)
create table if not exists memberships (
  workspace_id  text not null references workspaces(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null check (role in ('owner','editor','viewer')),
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists idx_memberships_user on memberships(user_id);

-- blueprints: workspace 당 1개. 본체는 jsonb (의미 그래프).
create table if not exists blueprints (
  workspace_id  text primary key references workspaces(id) on delete cascade,
  bp            jsonb not null,
  rev           int not null default 1,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id)
);

-- pending_proposals: confirm gate 대기열
create table if not exists pending_proposals (
  id            text primary key,
  workspace_id  text not null references workspaces(id) on delete cascade,
  ops           jsonb not null,
  intent        text,
  actor_id      uuid not null references auth.users(id),
  base_rev      int not null,
  impact        jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_pending_ws on pending_proposals(workspace_id);

-- audit_entries: append-only 감사 로그
create table if not exists audit_entries (
  id            bigserial primary key,
  workspace_id  text not null references workspaces(id) on delete cascade,
  ts            timestamptz not null default now(),
  actor_id      uuid references auth.users(id),
  kind          text not null check (kind in ('propose','confirm','reject','snapshot','restore')),
  proposal_id   text,
  rev           int,
  payload       jsonb
);
create index if not exists idx_audit_ws_ts on audit_entries(workspace_id, ts desc);

-- snapshots: confirm 시점 BP 사본 (롤백 가능)
create table if not exists snapshots (
  workspace_id  text not null references workspaces(id) on delete cascade,
  rev           int not null,
  sha           text not null,
  bp            jsonb not null,
  actor_id      uuid references auth.users(id),
  intent        text,
  created_at    timestamptz not null default now(),
  primary key (workspace_id, rev)
);
create index if not exists idx_snapshots_sha on snapshots(sha);

-- attachments: 본질 5번 — 노드별 레퍼런스 자료 메타. 실제 파일은 Supabase Storage / 외부 URL / 외부.
create table if not exists attachments (
  id            text primary key,
  workspace_id  text not null references workspaces(id) on delete cascade,
  node_id       text not null,
  kind          text not null check (kind in ('image','sketch','link','file')),
  title         text,
  url           text,           -- 외부 URL 또는 @idb:/@fs:/@supabase:/ 등의 ref
  storage_path  text,           -- Supabase Storage 객체 경로 (있을 시)
  mime          text,
  size          bigint,
  meta          jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_attachments_node on attachments(workspace_id, node_id);

-- ============ Row Level Security ============
alter table workspaces enable row level security;
alter table memberships enable row level security;
alter table blueprints enable row level security;
alter table pending_proposals enable row level security;
alter table audit_entries enable row level security;
alter table snapshots enable row level security;
alter table attachments enable row level security;

-- 헬퍼: 현재 사용자의 workspace_id 집합
create or replace view my_workspaces as
  select workspace_id, role from memberships where user_id = auth.uid();

-- workspaces: 멤버만 select. owner 만 update/delete.
create policy "workspaces select own"
  on workspaces for select
  using (id in (select workspace_id from my_workspaces));
create policy "workspaces insert by creator"
  on workspaces for insert
  with check (owner_id = auth.uid());
create policy "workspaces update by owner"
  on workspaces for update
  using (id in (select workspace_id from my_workspaces where role = 'owner'))
  with check (id in (select workspace_id from my_workspaces where role = 'owner'));
create policy "workspaces delete by owner"
  on workspaces for delete
  using (id in (select workspace_id from my_workspaces where role = 'owner'));

-- memberships: 멤버만 select. owner 만 insert/update/delete.
create policy "memberships select own ws"
  on memberships for select
  using (workspace_id in (select workspace_id from my_workspaces));
create policy "memberships modify by owner"
  on memberships for all
  using (workspace_id in (select workspace_id from my_workspaces where role = 'owner'))
  with check (workspace_id in (select workspace_id from my_workspaces where role = 'owner'));

-- blueprints: 멤버 select, editor 이상 update.
create policy "bp select"
  on blueprints for select
  using (workspace_id in (select workspace_id from my_workspaces));
create policy "bp update by editor"
  on blueprints for update
  using (workspace_id in (select workspace_id from my_workspaces where role in ('owner','editor')))
  with check (workspace_id in (select workspace_id from my_workspaces where role in ('owner','editor')));
create policy "bp insert by editor"
  on blueprints for insert
  with check (workspace_id in (select workspace_id from my_workspaces where role in ('owner','editor')));

-- pending_proposals: viewer 도 propose 가능 (insert). 전체 select 는 멤버. delete = editor 이상.
create policy "pp select"
  on pending_proposals for select
  using (workspace_id in (select workspace_id from my_workspaces));
create policy "pp insert any member"
  on pending_proposals for insert
  with check (workspace_id in (select workspace_id from my_workspaces));
create policy "pp delete by editor"
  on pending_proposals for delete
  using (workspace_id in (select workspace_id from my_workspaces where role in ('owner','editor')));

-- audit_entries: 멤버 select-only (append 는 트리거/함수로만)
create policy "audit select"
  on audit_entries for select
  using (workspace_id in (select workspace_id from my_workspaces));
-- audit insert 는 함수에서만 — 직접 insert 금지
create policy "audit no direct insert"
  on audit_entries for insert
  with check (false);

-- snapshots: 멤버 select. insert/restore 는 함수에서만.
create policy "snap select"
  on snapshots for select
  using (workspace_id in (select workspace_id from my_workspaces));
create policy "snap no direct insert"
  on snapshots for insert
  with check (false);

-- attachments: 멤버 select. editor 이상 insert/update. owner delete.
create policy "att select"
  on attachments for select
  using (workspace_id in (select workspace_id from my_workspaces));
create policy "att insert editor"
  on attachments for insert
  with check (workspace_id in (select workspace_id from my_workspaces where role in ('owner','editor')));
create policy "att update editor"
  on attachments for update
  using (workspace_id in (select workspace_id from my_workspaces where role in ('owner','editor')));
create policy "att delete editor"
  on attachments for delete
  using (workspace_id in (select workspace_id from my_workspaces where role in ('owner','editor')));

-- ============ Confirm gate — atomic confirm function ============
-- propose → confirm 시 baseRev 충돌 검사 + 단일 트랜잭션으로 적용.
-- SECURITY DEFINER 로 RLS bypass 후 application-level 권한 검사.
create or replace function confirm_proposal(p_id text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_p record;
  v_bp jsonb;
  v_rev int;
  v_role text;
  v_sha text;
  v_actor uuid := auth.uid();
begin
  -- 사용자 권한 확인
  select role into v_role from memberships
   where workspace_id = (select workspace_id from pending_proposals where id = p_id)
     and user_id = v_actor;
  if v_role not in ('owner','editor') then
    raise exception 'forbidden_confirm: role=%, required >= editor', coalesce(v_role,'none');
  end if;

  -- 제안 fetch + 잠금
  select * into v_p from pending_proposals where id = p_id for update;
  if not found then
    raise exception 'proposal_not_found: %', p_id;
  end if;

  -- rev 충돌 검사
  select bp, rev into v_bp, v_rev from blueprints where workspace_id = v_p.workspace_id for update;
  if v_p.base_rev <> v_rev then
    delete from pending_proposals where id = p_id;
    raise exception 'rev_mismatch: base=%, current=%', v_p.base_rev, v_rev;
  end if;

  -- ops 적용 — 핵심 로직은 application 에서 처리하는 게 일반적이라
  -- 여기서는 ops 를 audit 에 기록만 하고 BP 자체 변경은 application 측에서 별도 update 호출 권장.
  -- 또는 plpgsql 로 jsonb 조작 구현 가능 — 향후 확장.

  v_sha := encode(digest(v_bp::text, 'sha256'), 'hex');

  -- audit 기록
  insert into audit_entries(workspace_id, actor_id, kind, proposal_id, rev, payload)
    values (v_p.workspace_id, v_actor, 'confirm', p_id, v_rev + 1,
            jsonb_build_object('ops', v_p.ops, 'intent', v_p.intent));

  -- snapshot
  insert into snapshots(workspace_id, rev, sha, bp, actor_id, intent)
    values (v_p.workspace_id, v_rev + 1, v_sha, v_bp, v_actor, v_p.intent);

  -- 제안 제거
  delete from pending_proposals where id = p_id;

  return jsonb_build_object(
    'ok', true,
    'rev', v_rev + 1,
    'sha', v_sha,
    'proposal_id', p_id
  );
end;
$$;

-- ============ Triggers ============
-- blueprints update 시 자동 rev++
create or replace function bp_bump_rev()
returns trigger language plpgsql as $$
begin
  if (new.bp is distinct from old.bp) then
    new.rev := old.rev + 1;
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bp_bump on blueprints;
create trigger trg_bp_bump before update on blueprints
for each row execute function bp_bump_rev();

-- ============ Storage Bucket (선택) ============
-- Supabase Dashboard 에서 bucket 'ubp-attachments' 생성 권장.
-- 정책 예시 (Supabase Storage RLS):
--   "select own ws":  bucket_id = 'ubp-attachments' AND (storage.foldername(name))[1] in (select workspace_id from my_workspaces)
--   "insert editor":  bucket_id = 'ubp-attachments' AND (storage.foldername(name))[1] in (select workspace_id from my_workspaces where role in ('owner','editor'))
