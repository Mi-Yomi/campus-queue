-- Additive only: existing queues, tickets, identities and sessions are untouched.
create extension if not exists pg_net with schema extensions;

create table campus_private.push_settings (
 singleton boolean primary key default true check(singleton),
 public_key text not null default '',
 vapid_secret uuid,
 worker_secret uuid not null,
 worker_url text not null
);
insert into campus_private.push_settings(worker_secret,worker_url)
values(vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'campus_push_worker_key'),
 'https://yyngfnqgdwayqgjrwzgl.supabase.co/functions/v1/queue-push');

create table campus_private.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 endpoint_hash text not null unique,
 visitor_hash text not null,
 subscription jsonb not null,
 updated_at timestamptz not null default now()
);
create index push_subscriptions_visitor on campus_private.push_subscriptions(visitor_hash);
create table campus_private.push_outbox (
 id bigint generated always as identity primary key,
 subscription_id uuid not null references campus_private.push_subscriptions(id) on delete cascade,
 ticket_id text not null references campus_private.tickets(id) on delete cascade,
 called_at timestamptz not null,
 expires_at timestamptz not null,
 attempts int not null default 0,
 next_at timestamptz not null default now(),
 lease uuid,
 finished_at timestamptz,
 result text,
 http_status int,
 unique(subscription_id,ticket_id,called_at)
);
create index push_outbox_pending on campus_private.push_outbox(next_at) where finished_at is null;
create index push_outbox_ticket on campus_private.push_outbox(ticket_id);
create table campus_private.push_transfers (
 code_hash text primary key,
 visitor_hash text not null unique,
 encrypted_token bytea not null,
 expires_at timestamptz not null
);
alter table campus_private.push_settings enable row level security;
alter table campus_private.push_subscriptions enable row level security;
alter table campus_private.push_outbox enable row level security;
alter table campus_private.push_transfers enable row level security;
revoke all on campus_private.push_settings,campus_private.push_subscriptions,campus_private.push_outbox,campus_private.push_transfers from public,anon,authenticated;
grant all on campus_private.push_settings,campus_private.push_subscriptions,campus_private.push_outbox,campus_private.push_transfers to service_role;
grant usage,select on sequence campus_private.push_outbox_id_seq to service_role;

create function campus_private.push_wake() returns void
language plpgsql security invoker set search_path='' as $fn$
declare cfg campus_private.push_settings; secret text;
begin
 if not exists(select 1 from campus_private.push_outbox where finished_at is null and next_at<=now() and expires_at>now()) then return; end if;
 select * into cfg from campus_private.push_settings;
 if cfg.public_key='' then return; end if;
 select decrypted_secret into secret from vault.decrypted_secrets where id=cfg.worker_secret;
 perform net.http_post(url:=cfg.worker_url,headers:=jsonb_build_object('Content-Type','application/json','X-Queue-Push-Key',secret),body:='{}'::jsonb,timeout_milliseconds:=30000);
exception when others then
 -- Calling the next student must not depend on a network extension's health.
 -- The cron below retries pending work after this transaction commits.
 null;
end $fn$;

create function campus_private.push_on_call() returns trigger
language plpgsql security invoker set search_path='' as $fn$
begin
 if new.status='called' and new."calledAt" is not null and
   (tg_op='INSERT' or old.status is distinct from new.status or old."calledAt" is distinct from new."calledAt") then
  insert into campus_private.push_outbox(subscription_id,ticket_id,called_at,expires_at)
   select s.id,new.id,new."calledAt",now()+interval '90 seconds'
   from campus_private.push_subscriptions s where s.visitor_hash=new."visitorHash"
     and s.updated_at>now()-interval '90 days'
   on conflict do nothing;
  perform campus_private.push_wake();
 end if;
 return new;
end $fn$;
create trigger campus_ticket_push after insert or update of status,"calledAt" on campus_private.tickets
 for each row execute function campus_private.push_on_call();

create function public.campus_push_api(p_action text,p_visitor_hash text,p_body jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare cfg campus_private.push_settings; endpoint text; eh text; existing campus_private.push_subscriptions;
 code text; cipher_key text; transfer campus_private.push_transfers; token text;
begin
 if p_visitor_hash is null or p_visitor_hash !~ '^[a-f0-9]{64}$' then raise sqlstate 'PT400' using message='Не удалось распознать браузер.'; end if;
 if p_action='config' then
  select * into cfg from campus_private.push_settings;
  return jsonb_build_object('enabled',cfg.public_key<>'','publicKey',cfg.public_key);
 end if;
 -- Serialize mutations belonging to a visitor, including subscription limits.
 perform pg_advisory_xact_lock(hashtextextended(p_visitor_hash,731));
 if p_action in ('subscribe','unsubscribe','status') then
  endpoint:=coalesce(p_body->'subscription'->>'endpoint',p_body->>'endpoint');
  if endpoint is null or length(endpoint)>2048 then raise sqlstate 'PT400' using message='Некорректная подписка.'; end if;
  eh:=encode(extensions.digest(endpoint,'sha256'),'hex');
  select * into existing from campus_private.push_subscriptions where endpoint_hash=eh for update;
  if p_action='status' then return jsonb_build_object('enabled',existing.id is not null and existing.visitor_hash=p_visitor_hash); end if;
  if existing.id is not null and existing.visitor_hash<>p_visitor_hash then raise sqlstate 'PT403' using message='Подписка принадлежит другому браузеру. Отключите её и включите заново.'; end if;
  if p_action='unsubscribe' then
   delete from campus_private.push_subscriptions where endpoint_hash=eh and visitor_hash=p_visitor_hash;
   return jsonb_build_object('enabled',false);
  end if;
  if not exists(select 1 from campus_private.tickets t join campus_private.queues q on q.id=t."queueId"
    where t."visitorHash"=p_visitor_hash and t.generation=q.generation and q."endedAt" is null and t.status in ('waiting','called','done')) then
   raise sqlstate 'PT403' using message='Сначала получите талон в очередь.';
  end if;
  if existing.id is null and (select count(*) from campus_private.push_subscriptions where visitor_hash=p_visitor_hash)>=5 then
   raise sqlstate 'PT409' using message='Уведомления уже подключены на пяти устройствах.';
  end if;
  insert into campus_private.push_subscriptions(endpoint_hash,visitor_hash,subscription) values(eh,p_visitor_hash,p_body->'subscription')
   on conflict(endpoint_hash) do update set subscription=excluded.subscription,updated_at=now()
   where campus_private.push_subscriptions.visitor_hash=excluded.visitor_hash;
  return jsonb_build_object('enabled',true);
 elsif p_action='transfer-create' then
  token:=p_body->>'token';
  if token is null or encode(extensions.digest(token,'sha256'),'hex')<>p_visitor_hash then raise sqlstate 'PT403' using message='Некорректный перенос.'; end if;
  if not exists(select 1 from campus_private.tickets where "visitorHash"=p_visitor_hash) then raise sqlstate 'PT409' using message='Пока нет талонов для переноса.'; end if;
  select v.decrypted_secret into cipher_key from campus_private.push_settings c join vault.decrypted_secrets v on v.id=c.worker_secret;
  code:=upper(encode(extensions.gen_random_bytes(8),'hex'));
  delete from campus_private.push_transfers where visitor_hash=p_visitor_hash;
  insert into campus_private.push_transfers values(encode(extensions.digest(code,'sha256'),'hex'),p_visitor_hash,
   extensions.pgp_sym_encrypt(token,cipher_key),now()+interval '20 minutes');
  return jsonb_build_object('code',code,'expiresAt',campus_private.ms()+1200000);
 elsif p_action='transfer-claim' then
  code:=p_body->>'code';
  if code is null or code !~ '^[0-9A-F]{16}$' then raise sqlstate 'PT400' using message='Введите 16 символов кода переноса.'; end if;
  select * into transfer from campus_private.push_transfers where code_hash=encode(extensions.digest(code,'sha256'),'hex') for update;
  if transfer.code_hash is null or transfer.expires_at<now() then raise sqlstate 'PT410' using message='Код не найден или истёк. Получите новый в браузере с вашим талоном.'; end if;
  if transfer.visitor_hash<>p_visitor_hash and exists(select 1 from campus_private.tickets t join campus_private.queues q on q.id=t."queueId"
   where t."visitorHash"=p_visitor_hash and t.generation=q.generation and q."endedAt" is null and t.status in ('waiting','called')) then
   raise sqlstate 'PT409' using message='В этом окне уже есть активный талон. Сначала завершите его.';
  end if;
  select v.decrypted_secret into cipher_key from campus_private.push_settings c join vault.decrypted_secrets v on v.id=c.worker_secret;
  token:=extensions.pgp_sym_decrypt(transfer.encrypted_token,cipher_key);
  delete from campus_private.push_transfers where code_hash=transfer.code_hash;
  return jsonb_build_object('token',token);
 end if;
 raise sqlstate 'PT404' using message='Такого метода нет.';
end $fn$;

create function public.campus_push_worker_config(p_secret text) returns jsonb
language plpgsql security invoker set search_path='' as $fn$
declare cfg campus_private.push_settings; expected text; keys jsonb;
begin
 select * into cfg from campus_private.push_settings;
 select decrypted_secret into expected from vault.decrypted_secrets where id=cfg.worker_secret;
 if p_secret is null or extensions.digest(p_secret,'sha256') is distinct from extensions.digest(expected,'sha256') then return null; end if;
 select decrypted_secret::jsonb into keys from vault.decrypted_secrets where id=cfg.vapid_secret;
 return keys;
end $fn$;

create function public.campus_push_claim() returns jsonb
language plpgsql security invoker set search_path='' as $fn$
declare result jsonb;
begin
 -- Drop delayed calls when a ticket has already been served/skipped/ended.
 update campus_private.push_outbox o set finished_at=now(),result='expired'
 where finished_at is null and (expires_at<=now() or attempts>=3 or not exists(
   select 1 from campus_private.tickets t join campus_private.queues q on q.id=t."queueId" join campus_private.users u on u.id=q."ownerId"
   where t.id=o.ticket_id and t.status='called' and t."calledAt"=o.called_at and t.generation=q.generation and q."endedAt" is null and u.active));
 with picked as (
  select id from campus_private.push_outbox where finished_at is null and next_at<=now()
   order by id limit 20 for update skip locked
 ), claimed as (
  update campus_private.push_outbox o set attempts=attempts+1,lease=gen_random_uuid(),next_at=now()+interval '45 seconds'
   from picked where o.id=picked.id returning o.*
 ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'lease',c.lease,'ticketId',t.id,'queueId',q.id,
  'number',t.number,'title',q.title,'topic',substr(encode(extensions.digest(t.id,'sha256'),'hex'),1,32),
  'expiresAt',extract(epoch from c.expires_at)*1000,'subscription',s.subscription)),'[]'::jsonb) into result
 from claimed c join campus_private.tickets t on t.id=c.ticket_id join campus_private.queues q on q.id=t."queueId"
 join campus_private.push_subscriptions s on s.id=c.subscription_id;
 return result;
end $fn$;

create function public.campus_push_finish(p_id bigint,p_lease uuid,p_result text,p_status int) returns void
language plpgsql security invoker set search_path='' as $fn$
declare job campus_private.push_outbox;
begin
 select * into job from campus_private.push_outbox where id=p_id and lease=p_lease and finished_at is null for update;
 if job.id is null then return; end if;
 if p_result='gone' then delete from campus_private.push_subscriptions where id=job.subscription_id; return; end if;
 if p_result='retry' and job.attempts<3 and job.expires_at>now() then
  update campus_private.push_outbox set next_at=now()+interval '5 seconds',http_status=p_status where id=p_id;
 else
  update campus_private.push_outbox set finished_at=now(),result=p_result,http_status=p_status where id=p_id;
 end if;
end $fn$;

create function campus_private.push_maintenance() returns void
language plpgsql security invoker set search_path='' as $fn$
begin
 delete from campus_private.push_outbox where expires_at<now()-interval '1 day';
 delete from campus_private.push_subscriptions where updated_at<now()-interval '90 days';
 delete from campus_private.push_transfers where expires_at<now();
end $fn$;

revoke all on function campus_private.push_wake(),campus_private.push_on_call(),campus_private.push_maintenance(),
 public.campus_push_api(text,text,jsonb),public.campus_push_worker_config(text),public.campus_push_claim(),public.campus_push_finish(bigint,uuid,text,int) from public,anon,authenticated;
grant execute on function campus_private.push_wake(),campus_private.push_on_call(),campus_private.push_maintenance(),
 public.campus_push_api(text,text,jsonb),public.campus_push_worker_config(text),public.campus_push_claim(),public.campus_push_finish(bigint,uuid,text,int) to service_role;
-- SQL-only checks: an idle queue does not create Edge Function invocations.
select cron.schedule('campus-push-retry','10 seconds','select campus_private.push_wake()');
select cron.schedule('campus-push-cleanup','17 * * * *','select campus_private.push_maintenance()');
