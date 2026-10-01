-- Private data is accessible only to the server-side service role.
create schema if not exists campus_private;
revoke all on schema campus_private from public, anon, authenticated;
grant usage on schema campus_private to service_role;
create extension if not exists pgcrypto with schema extensions;

create table campus_private.users (
 id text primary key default gen_random_uuid()::text, username text unique not null,
 name text not null, role text not null check(role in ('owner','teacher')),
 "passwordHash" text not null, active boolean not null default true,
 "createdAt" timestamptz not null default now()
);
create table campus_private.queues (
 id text primary key default gen_random_uuid()::text,
 "ownerId" text not null references campus_private.users(id), title text not null, room text not null,
 status text not null default 'open' check(status in ('open','paused','closed')),
 "avgMinutes" int not null default 5 check("avgMinutes" between 1 and 120),
 "maxQueue" int not null default 60 check("maxQueue" between 1 and 500),
 generation int not null default 1, revision bigint not null default 0,
 "createdAt" timestamptz not null default now()
);
create index on campus_private.queues("ownerId");
create table campus_private.tickets (
 id text primary key default gen_random_uuid()::text, "queueId" text not null references campus_private.queues(id),
 generation int not null, seq int not null, number text not null, "visitorHash" text not null,
 name text not null, "studentGroup" text not null,
 status text not null check(status in ('waiting','called','done','skipped','cancelled')),
 "createdAt" timestamptz not null default now(), "calledAt" timestamptz, "finishedAt" timestamptz,
 unique("queueId",generation,seq)
);
create unique index tickets_one_active on campus_private.tickets("queueId","visitorHash") where status in ('waiting','called');
create unique index tickets_one_called on campus_private.tickets("queueId",generation) where status='called';
create index on campus_private.tickets("queueId",generation,status,seq);
create index on campus_private.tickets("visitorHash","createdAt" desc);
create table campus_private.sessions (
 "tokenHash" text primary key, "userId" text not null references campus_private.users(id),
 kind text not null default 'admin' check(kind in ('admin','display')), "queueId" text references campus_private.queues(id),
 generation int, "expiresAt" bigint not null
);
create index on campus_private.sessions("userId");
create index on campus_private.sessions("queueId");
create table campus_private.grants (
 id text primary key default gen_random_uuid()::text, "inviteHash" text not null,
 "queueId" text not null references campus_private.queues(id), generation int not null,
 "visitorHash" text not null, "expiresAt" bigint not null,
 "consumedTicketId" text references campus_private.tickets(id), unique("inviteHash","visitorHash")
);
create index on campus_private.grants("queueId","visitorHash","expiresAt");
create index on campus_private.grants("consumedTicketId");
create table campus_private.meta (key text primary key, value text not null);
insert into campus_private.meta values ('invite_secret',encode(extensions.gen_random_bytes(32),'hex'));
create table campus_private.rate_limits (key text primary key, hits int not null, until_at bigint not null);
create index on campus_private.rate_limits(until_at);

create table public.campus_queue_live (
 queue_id text primary key references campus_private.queues(id), revision bigint not null,
 snapshot jsonb not null, updated_at timestamptz not null default now()
);
alter table public.campus_queue_live enable row level security;
revoke all on public.campus_queue_live from anon, authenticated;
grant select on public.campus_queue_live to anon, authenticated;
grant all on public.campus_queue_live to service_role;
create policy "Public queue numbers only" on public.campus_queue_live for select to anon, authenticated using (true);
alter publication supabase_realtime add table public.campus_queue_live;

do $$ declare t text; begin
 foreach t in array array['users','queues','tickets','sessions','grants','meta','rate_limits'] loop
  execute format('alter table campus_private.%I enable row level security',t);
 end loop;
end $$;
grant all on all tables in schema campus_private to service_role;

create function campus_private.ms() returns bigint language sql volatile set search_path='' as $$
 select floor(extract(epoch from clock_timestamp())*1000)::bigint;
$$;
create function campus_private.fail(code int, message text) returns void language plpgsql set search_path='' as $$
begin raise exception using errcode='PT'||code::text, message=message; end;
$$;
create function campus_private.safe_user(u campus_private.users) returns jsonb language sql immutable set search_path='' as $$
 select to_jsonb(u)-'passwordHash';
$$;
create function campus_private.settings(qid text) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(q)||jsonb_build_object('teacherName',u.name,'teacherActive',u.active)
 from campus_private.queues q join campus_private.users u on u.id=q."ownerId" where q.id=qid;
$$;
create function campus_private.snapshot(qid text, vh text default null, is_admin boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare q campus_private.queues; all_t jsonb; wait_t jsonb; curr jsonb; mine jsonb; adm jsonb; pos int; ahead int;
begin
 select * into q from campus_private.queues where id=qid;
 if not found then perform campus_private.fail(404,'Очередь не найдена.'); end if;
 select coalesce(jsonb_agg(to_jsonb(t)-'visitorHash' order by seq),'[]'::jsonb) into all_t
 from campus_private.tickets t where "queueId"=qid and generation=q.generation;
 select coalesce(jsonb_agg(t order by (t->>'seq')::int),'[]'::jsonb) into wait_t from jsonb_array_elements(all_t) t where t->>'status'='waiting';
 select t into curr from jsonb_array_elements(all_t) t where t->>'status'='called' limit 1;
 if vh is not null then
  select to_jsonb(t)-'visitorHash' into mine from campus_private.tickets t where "queueId"=qid and "visitorHash"=vh order by generation desc,seq desc limit 1;
  if mine is not null then
   select ord::int into pos from jsonb_array_elements(wait_t) with ordinality w(t,ord) where t->>'id'=mine->>'id';
   ahead:=case when pos is null then 0 else pos-1+case when curr is null then 0 else 1 end end;
   mine:=mine||jsonb_build_object('position',coalesce(pos,0),'ahead',ahead,'estimatedMinutes',ahead*q."avgMinutes",'previousSession',(mine->>'generation')::int<>q.generation);
  end if;
  select jsonb_build_object('id',g.id,'expiresAt',g."expiresAt",'generation',g.generation) into adm
   from campus_private.grants g where "queueId"=qid and generation=q.generation and "visitorHash"=vh and "consumedTicketId" is null and "expiresAt">campus_private.ms() order by "expiresAt" desc limit 1;
 end if;
 return jsonb_build_object(
  'settings',campus_private.settings(qid),'revision',q.revision,'serverTime',clock_timestamp(),'serverNow',campus_private.ms(),
  'mine',mine,'admission',adm,'canShare',coalesce((campus_private.settings(qid)->>'teacherActive')::boolean and q.status='open' and not (mine->>'previousSession')::boolean and mine->>'status' in ('waiting','called'),false),
  'stats',jsonb_build_object('waiting',jsonb_array_length(wait_t),'total',jsonb_array_length(all_t),'completed',(select count(*) from jsonb_array_elements(all_t) t where t->>'status'='done'),'skipped',(select count(*) from jsonb_array_elements(all_t) t where t->>'status'='skipped')),
  'current',case when curr is null then null when is_admin then curr else jsonb_build_object('number',curr->>'number','calledAt',curr->'calledAt') end,
  'nextNumbers',(select coalesce(jsonb_agg(t->'number'),'[]'::jsonb) from (select t from jsonb_array_elements(wait_t) t limit 5) x)
 ) || case when is_admin then jsonb_build_object('tickets',all_t) else '{}'::jsonb end;
end;
$$;
create function campus_private.publish(qid text) returns void language plpgsql set search_path='' as $$
declare snap jsonb; states jsonb; rev bigint;
begin
 update campus_private.queues set revision=revision+1 where id=qid returning revision into rev;
 snap:=campus_private.snapshot(qid);
 select coalesce(jsonb_agg(jsonb_build_object('seq',t.seq,'number',t.number,'status',t.status,'calledAt',t."calledAt",'finishedAt',t."finishedAt") order by seq),'[]'::jsonb)
 into states from campus_private.tickets t join campus_private.queues q on q.id=t."queueId" and q.generation=t.generation where q.id=qid;
 snap:=(snap-'mine'-'admission'-'canShare')||jsonb_build_object('states',states);
 insert into public.campus_queue_live(queue_id,revision,snapshot) values(qid,rev,snap)
 on conflict(queue_id) do update set revision=excluded.revision,snapshot=excluded.snapshot,updated_at=clock_timestamp();
end;
$$;
create function campus_private.actor(sh text, expected_kind text default 'admin') returns campus_private.users
language plpgsql set search_path='' as $$
declare u campus_private.users;
begin
 select u1.* into u from campus_private.sessions s join campus_private.users u1 on u1.id=s."userId"
 where s."tokenHash"=sh and s.kind=expected_kind and s."expiresAt">campus_private.ms() and u1.active;
 if not found then perform campus_private.fail(401,'Сессия истекла. Войдите снова.'); end if;
 return u;
end;
$$;
create function campus_private.new_session(uid text, kind text default 'admin', qid text default null) returns text
language plpgsql set search_path='' as $$
declare token text:=encode(extensions.gen_random_bytes(32),'hex');
begin
 delete from campus_private.sessions where "expiresAt"<campus_private.ms();
 insert into campus_private.sessions values(encode(extensions.digest(token,'sha256'),'hex'),uid,kind,qid,(select generation from campus_private.queues where id=qid),campus_private.ms()+43200000);
 return token;
end;
$$;
create function campus_private.require_open(q campus_private.queues) returns void language plpgsql set search_path='' as $$
begin
 if not (select active from campus_private.users where id=q."ownerId") then perform campus_private.fail(409,'Аккаунт преподавателя приостановлен.'); end if;
 if q.status<>'open' then perform campus_private.fail(409,'Запись сейчас закрыта.'); end if;
end;
$$;
create function campus_private.issuer_valid(claims jsonb, q campus_private.queues) returns boolean language plpgsql set search_path='' as $$
begin
 if claims->>'kind'='ticket' then
  return exists(select 1 from campus_private.tickets where id=claims->>'issuer' and "queueId"=q.id and generation=q.generation and status in ('waiting','called'));
 elsif claims->>'kind'='session' then
  return exists(select 1 from campus_private.sessions s join campus_private.users u on u.id=s."userId"
   where s."tokenHash"=claims->>'issuer' and s."expiresAt">campus_private.ms() and u.active and (u.role='owner' or u.id=q."ownerId") and (s.kind='admin' or (s.kind='display' and s."queueId"=q.id and s.generation=q.generation)));
 end if;
 return false;
end;
$$;

-- Edge-only entrypoints: SECURITY INVOKER, no privileges granted to browser roles.
create function public.campus_rate(p_key text,p_limit int,p_window int) returns boolean language plpgsql set search_path='' as $$
declare n int; now_ms bigint:=campus_private.ms();
begin
 insert into campus_private.rate_limits(key,hits,until_at) values(p_key,1,now_ms+p_window)
 on conflict(key) do update set hits=case when campus_private.rate_limits.until_at<=now_ms then 1 else campus_private.rate_limits.hits+1 end,
 until_at=case when campus_private.rate_limits.until_at<=now_ms then now_ms+p_window else campus_private.rate_limits.until_at end returning hits into n;
 if random()<0.01 then delete from campus_private.rate_limits where until_at<now_ms; end if;
 return n<=p_limit;
end;
$$;
create function public.campus_login_context(p_username text) returns text language sql set search_path='' as $$
 select "passwordHash" from campus_private.users where username=lower(p_username);
$$;

create function public.campus_api(p_method text,p_path text,p_credentials jsonb,p_body jsonb default '{}'::jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
 vh text:=p_credentials->>'visitorHash'; sh text:=p_credentials->>'adminHash'; dh text:=p_credentials->>'displayHash';
 a campus_private.users; target campus_private.users; q campus_private.queues; t campus_private.tickets; g campus_private.grants;
 qid text; parts text[]:=string_to_array(trim(both '/' from p_path),'/'); is_admin boolean:=false;
 result jsonb; claims jsonb; payload text; signature text; secret text; issuer text; issuer_kind text; raw_invite text;
 now_ms bigint; seq_no int; new_id text; session_token text; queue_row record;
begin
 if p_path='/health' and p_method='GET' then return jsonb_build_object('ok',true,'version',3,'backend','supabase'); end if;
 if p_path='/admin/login' and p_method='POST' then
  select * into a from campus_private.users where username=lower(p_body->>'username') and active and "passwordHash"=p_body->>'_verifiedHash';
  if not found then perform campus_private.fail(401,'Неверный логин или пароль, либо аккаунт отключён.'); end if;
  return jsonb_build_object('token',campus_private.new_session(a.id),'user',campus_private.safe_user(a));
 end if;
 if parts[1]='admin' then a:=campus_private.actor(sh); is_admin:=true; end if;
 if p_path='/admin/me' and p_method='GET' then return jsonb_build_object('user',campus_private.safe_user(a)); end if;
 if p_path='/admin/logout' and p_method='POST' then delete from campus_private.sessions where "tokenHash"=sh; return jsonb_build_object('ok',true); end if;
 if p_path='/admin/network' and p_method='GET' then return jsonb_build_object('addresses','[]'::jsonb); end if;
 if p_path='/me/tickets' and p_method='GET' then
  select coalesce(jsonb_agg((to_jsonb(x)-'visitorHash')||jsonb_build_object('queue',campus_private.settings(x."queueId")) order by x."createdAt" desc),'[]'::jsonb) into result
   from (select distinct on ("queueId") * from campus_private.tickets where "visitorHash"=vh order by "queueId",generation desc,seq desc limit 30) x;
  return jsonb_build_object('tickets',result,'serverNow',campus_private.ms());
 end if;
 if p_path='/admin/queues' then
  if p_method='GET' then
   select coalesce(jsonb_agg(campus_private.settings(x.id)||jsonb_build_object('waiting',(select count(*) from campus_private.tickets where "queueId"=x.id and generation=x.generation and status='waiting')) order by x."createdAt" desc),'[]'::jsonb) into result
   from campus_private.queues x where a.role='owner' or x."ownerId"=a.id;
   return jsonb_build_object('queues',result);
  elsif p_method='POST' then
   insert into campus_private.queues("ownerId",title,room,status,"avgMinutes","maxQueue") values(a.id,p_body->>'title',p_body->>'room',coalesce(p_body->>'status','open'),coalesce((p_body->>'avgMinutes')::int,5),coalesce((p_body->>'maxQueue')::int,60)) returning id into new_id;
   perform campus_private.publish(new_id); return jsonb_build_object('queue',campus_private.settings(new_id));
  end if;
 end if;
 if parts[1]='admin' and parts[2]='teachers' then
  if a.role<>'owner' then perform campus_private.fail(403,'Это действие доступно только владельцу.'); end if;
  if array_length(parts,1)=2 and p_method='GET' then
   select coalesce(jsonb_agg(campus_private.safe_user(u) order by name),'[]'::jsonb) into result from campus_private.users u where role='teacher'; return jsonb_build_object('teachers',result);
  elsif array_length(parts,1)=2 and p_method='POST' then
   if exists(select 1 from campus_private.users where username=p_body->>'username') then perform campus_private.fail(409,'Этот логин уже занят.'); end if;
   insert into campus_private.users(username,name,role,"passwordHash") values(p_body->>'username',p_body->>'name','teacher',p_body->>'_hash') returning * into target;
   return jsonb_build_object('user',campus_private.safe_user(target),'password',p_body->>'_password');
  elsif array_length(parts,1)=3 and p_method='PATCH' then
   select * into target from campus_private.users where id=parts[3] and role='teacher' for update;
   if not found then perform campus_private.fail(404,'Преподаватель не найден.'); end if;
   update campus_private.users set active=coalesce((p_body->>'active')::boolean,active),"passwordHash"=case when p_body->>'resetPassword'='true' then p_body->>'_hash' else "passwordHash" end where id=target.id returning * into target;
   if p_body->>'active'='false' or p_body->>'resetPassword'='true' then delete from campus_private.sessions where "userId"=target.id; end if;
   if p_body->>'active'='false' then update campus_private.grants set "expiresAt"=0 where "queueId" in(select id from campus_private.queues where "ownerId"=target.id) and "consumedTicketId" is null; end if;
   for queue_row in select id from campus_private.queues where "ownerId"=target.id order by id loop perform campus_private.publish(queue_row.id); end loop;
   return jsonb_build_object('user',campus_private.safe_user(target))||case when p_body->>'resetPassword'='true' then jsonb_build_object('password',p_body->>'_password') else '{}'::jsonb end;
  end if;
 end if;
 if parts[1]='queues' then qid:=parts[2];
 elsif parts[1] in ('admin','display') and parts[2]='queues' then qid:=parts[3];
 else perform campus_private.fail(404,'Такого метода API нет.'); end if;
 -- Serialize mutations per class. Reads and QR issuance do not acquire a row lock.
 if p_method='GET' then select * into q from campus_private.queues where id=qid;
 else select * into q from campus_private.queues where id=qid for update; end if;
 if q.id is null then perform campus_private.fail(404,'Очередь не найдена.'); end if;
 if is_admin and a.role<>'owner' and a.id<>q."ownerId" then perform campus_private.fail(403,'У вас нет доступа к этой очереди.'); end if;
 if parts[1]='display' then
  a:=campus_private.actor(dh,'display');
  if not exists(select 1 from campus_private.sessions where "tokenHash"=dh and "queueId"=qid and generation=q.generation) then perform campus_private.fail(403,'Табло относится к другой паре.'); end if;
 end if;
 if p_method='GET' and ((parts[1]='queues' and array_length(parts,1)=2) or (is_admin and array_length(parts,1)=3)) then return campus_private.snapshot(qid,case when is_admin then null else vh end,is_admin); end if;
 if p_method='GET' and parts[array_length(parts,1)]='invite' then
  perform campus_private.require_open(q);
  if is_admin or parts[1]='display' then issuer_kind:='session'; issuer:=case when is_admin then sh else dh end;
  else
   select id into issuer from campus_private.tickets where "queueId"=qid and generation=q.generation and "visitorHash"=vh and status in ('waiting','called'); issuer_kind:='ticket';
   if issuer is null then perform campus_private.fail(403,'Показать QR может только студент с активным талоном этой пары.'); end if;
  end if;
  now_ms:=campus_private.ms();
  claims:=jsonb_build_object('q',qid,'g',q.generation,'kind',issuer_kind,'issuer',issuer,'iat',(now_ms/10000)*10000,'exp',(now_ms/10000)*10000+10000);
  payload:=encode(convert_to(claims::text,'UTF8'),'hex'); select value into secret from campus_private.meta where key='invite_secret';
  signature:=encode(extensions.hmac(payload,secret,'sha256'),'hex');
  return jsonb_build_object('invite',payload||'.'||signature,'expiresAt',claims->'exp','serverNow',now_ms,'intervalMs',10000);
 end if;
 if is_admin and p_method='POST' and parts[4]='display-session' then return jsonb_build_object('token',campus_private.new_session(a.id,'display',qid),'generation',q.generation); end if;
 if not is_admin and parts[1]='queues' and p_method='POST' and parts[3]='redeem' then
  if exists(select 1 from campus_private.tickets where "queueId"=qid and generation=q.generation and "visitorHash"=vh and status in ('waiting','called')) then return campus_private.snapshot(qid,vh); end if;
  raw_invite:=p_body->>'invite';
  if raw_invite is null or length(raw_invite)>2000 or raw_invite !~ '^[a-f0-9]+\.[a-f0-9]{64}$' then perform campus_private.fail(400,'Некорректный QR-код.'); end if;
  payload:=split_part(raw_invite,'.',1); signature:=split_part(raw_invite,'.',2); select value into secret from campus_private.meta where key='invite_secret';
  if signature<>encode(extensions.hmac(payload,secret,'sha256'),'hex') then perform campus_private.fail(400,'Подпись QR-кода не прошла проверку.'); end if;
  claims:=convert_from(decode(payload,'hex'),'UTF8')::jsonb; now_ms:=campus_private.ms();
  if claims->>'q'<>qid then perform campus_private.fail(400,'QR относится к другой очереди.'); end if;
  if (claims->>'g')::int<>q.generation or now_ms>=(claims->>'exp')::bigint or now_ms<(claims->>'iat')::bigint then perform campus_private.fail(410,'QR-код устарел. Отсканируйте текущий код у преподавателя или одногруппника.'); end if;
  perform campus_private.require_open(q);
  if not campus_private.issuer_valid(claims,q) then perform campus_private.fail(410,'QR отозван. Попросите свежий код.'); end if;
  insert into campus_private.grants("inviteHash","queueId",generation,"visitorHash","expiresAt") values(encode(extensions.digest(raw_invite,'sha256'),'hex'),qid,q.generation,vh,now_ms+120000) on conflict("inviteHash","visitorHash") do nothing;
  return campus_private.snapshot(qid,vh);
 end if;
 if not is_admin and parts[1]='queues' and p_method='POST' and parts[3]='join' then
  select * into g from campus_private.grants where id=p_body->>'grantId' and "queueId"=qid and "visitorHash"=vh;
  if g."consumedTicketId" is not null or exists(select 1 from campus_private.tickets where "queueId"=qid and "visitorHash"=vh and status in ('waiting','called')) then return campus_private.snapshot(qid,vh); end if;
  perform campus_private.require_open(q);
  if g.id is null or g."expiresAt"<=campus_private.ms() or g.generation<>q.generation then perform campus_private.fail(410,'Время записи истекло. Отсканируйте свежий QR-код.'); end if;
  if (select count(*) from campus_private.tickets where "queueId"=qid and generation=q.generation and status in ('waiting','called'))>=q."maxQueue" then perform campus_private.fail(409,'Очередь заполнена. Попробуйте, когда освободится место.'); end if;
  select coalesce(max(seq),0)+1 into seq_no from campus_private.tickets where "queueId"=qid and generation=q.generation;
  insert into campus_private.tickets("queueId",generation,seq,number,"visitorHash",name,"studentGroup",status) values(qid,q.generation,seq_no,'A-'||lpad(seq_no::text,greatest(3,length(seq_no::text)),'0'),vh,p_body->>'name',p_body->>'studentGroup','waiting') returning id into new_id;
  update campus_private.grants set "consumedTicketId"=new_id where id=g.id;
 elsif not is_admin and parts[1]='queues' and p_method='POST' and parts[3]='leave' then
  update campus_private.tickets set status='cancelled',"finishedAt"=clock_timestamp() where "queueId"=qid and "visitorHash"=vh and status in ('waiting','called');
  if not found then perform campus_private.fail(409,'Активного талона нет.'); end if;
 elsif is_admin and p_method='PATCH' and parts[4]='settings' then
  update campus_private.queues set title=coalesce(p_body->>'title',title),room=coalesce(p_body->>'room',room),status=coalesce(p_body->>'status',status),"avgMinutes"=coalesce((p_body->>'avgMinutes')::int,"avgMinutes"),"maxQueue"=coalesce((p_body->>'maxQueue')::int,"maxQueue") where id=qid;
 elsif is_admin and p_method='POST' and parts[4]='next' then
  if exists(select 1 from campus_private.tickets where "queueId"=qid and generation=q.generation and status='called') then perform campus_private.fail(409,'Сначала завершите приём текущего студента.'); end if;
  select * into t from campus_private.tickets where "queueId"=qid and generation=q.generation and status='waiting' order by seq limit 1;
  if t.id is null then perform campus_private.fail(409,'Очередь пока пуста.'); end if;
  update campus_private.tickets set status='called',"calledAt"=clock_timestamp() where id=t.id;
 elsif is_admin and p_method='POST' and parts[4]='tickets' and parts[6]='finish' then
  update campus_private.tickets set status=p_body->>'status',"finishedAt"=clock_timestamp() where id=parts[5] and "queueId"=qid and generation=q.generation and status='called';
  if not found then perform campus_private.fail(409,'Этот талон уже не находится на приёме.'); end if;
 elsif is_admin and p_method='POST' and parts[4]='reset' then
  if p_body->>'confirmation'<>'НОВАЯ ПАРА' then perform campus_private.fail(400,'Введите НОВАЯ ПАРА.'); end if;
  if (p_body->>'generation')::int<>q.generation then perform campus_private.fail(409,'Новая пара уже начата в другой вкладке.'); end if;
  update campus_private.tickets set status='cancelled',"finishedAt"=clock_timestamp() where "queueId"=qid and status in ('waiting','called');
  update campus_private.queues set generation=generation+1,status='open' where id=qid;
  delete from campus_private.sessions where kind='display' and "queueId"=qid;
 else perform campus_private.fail(404,'Такого метода API нет.'); end if;
 perform campus_private.publish(qid);
 return campus_private.snapshot(qid,case when is_admin then null else vh end,is_admin);
end;
$$;

revoke all on all functions in schema campus_private from public, anon, authenticated;
grant execute on all functions in schema campus_private to service_role;
revoke all on function public.campus_api(text,text,jsonb,jsonb),public.campus_rate(text,int,int),public.campus_login_context(text) from public,anon,authenticated;
grant execute on function public.campus_api(text,text,jsonb,jsonb),public.campus_rate(text,int,int),public.campus_login_context(text) to service_role;
