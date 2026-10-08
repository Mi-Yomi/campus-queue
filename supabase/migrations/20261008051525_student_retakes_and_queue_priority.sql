-- Stable ticket numbers are separate from the teacher's call order.
alter table campus_private.tickets
 add column "queueOrder" integer not null default 0,
 add column "retryOf" text references campus_private.tickets(id),
 add column attempt integer not null default 1 check(attempt>0);
update campus_private.tickets set "queueOrder"=seq;
create unique index campus_ticket_retry on campus_private.tickets("retryOf") where "retryOf" is not null;
create index campus_waiting_order on campus_private.tickets("queueId",generation,status,"queueOrder",seq);

CREATE OR REPLACE FUNCTION campus_private.snapshot(qid text, vh text DEFAULT NULL::text, is_admin boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare q campus_private.queues; all_t jsonb; wait_t jsonb; curr jsonb; mine jsonb; adm jsonb; pos int; ahead int; sample_count bigint; average_seconds numeric; total_seconds numeric;
begin
 select * into q from campus_private.queues where id=qid;
 if not found then perform campus_private.fail(404,'Очередь не найдена.'); end if;
 select coalesce(jsonb_agg(to_jsonb(t)-'visitorHash' order by case when status='called' then 0 else 1 end,"queueOrder",seq),'[]'::jsonb) into all_t
 from campus_private.tickets t where "queueId"=qid and generation=q.generation;
 select count(*),avg(extract(epoch from ("finishedAt"-"calledAt"))),coalesce(sum(extract(epoch from ("finishedAt"-"calledAt"))),0)
 into sample_count,average_seconds,total_seconds from campus_private.tickets
 where "queueId"=qid and generation=q.generation and status='done' and "calledAt" is not null and "finishedAt">"calledAt";
 select coalesce(jsonb_agg(t order by (t->>'queueOrder')::int,(t->>'seq')::int),'[]'::jsonb) into wait_t from jsonb_array_elements(all_t) t where t->>'status'='waiting';
 select t into curr from jsonb_array_elements(all_t) t where t->>'status'='called' limit 1;
 if vh is not null then
  select to_jsonb(t)-'visitorHash' into mine from campus_private.tickets t where "queueId"=qid and "visitorHash"=vh order by generation desc,seq desc limit 1;
  if mine is not null then
   select ord::int into pos from jsonb_array_elements(wait_t) with ordinality w(t,ord) where t->>'id'=mine->>'id';
   ahead:=case when pos is null then 0 else pos-1+case when curr is null then 0 else 1 end end;
   mine:=mine||jsonb_build_object('position',coalesce(pos,0),'ahead',ahead,'estimatedMinutes',case when ahead=0 then 0 when average_seconds is null then null else ceil(ahead*average_seconds/60) end,'previousSession',(mine->>'generation')::int<>q.generation);
  end if;
  select jsonb_build_object('id',g.id,'expiresAt',g."expiresAt",'generation',g.generation) into adm
   from campus_private.grants g where "queueId"=qid and generation=q.generation and "visitorHash"=vh and "consumedTicketId" is null and "expiresAt">campus_private.ms() order by "expiresAt" desc limit 1;
 end if;
 return jsonb_build_object(
  'analytics',jsonb_build_object('sampleCount',sample_count,'averageSeconds',average_seconds,'totalSeconds',total_seconds),
  'settings',campus_private.settings(qid),'revision',q.revision,'serverTime',clock_timestamp(),'serverNow',campus_private.ms(),
  'mine',mine,'admission',adm,'canShare',coalesce((campus_private.settings(qid)->>'teacherActive')::boolean and q.status='open' and not (mine->>'previousSession')::boolean and mine->>'status' in ('waiting','called'),false),
  'stats',jsonb_build_object('waiting',jsonb_array_length(wait_t),'total',jsonb_array_length(all_t),'completed',(select count(*) from jsonb_array_elements(all_t) t where t->>'status'='done'),'skipped',(select count(*) from jsonb_array_elements(all_t) t where t->>'status'='skipped')),
  'current',case when curr is null then null when is_admin then curr else jsonb_build_object('number',curr->>'number','calledAt',curr->'calledAt') end,
  'nextNumbers',(select coalesce(jsonb_agg(t->'number'),'[]'::jsonb) from (select t from jsonb_array_elements(wait_t) t limit 5) x)
 ) || case when is_admin then jsonb_build_object('tickets',all_t)
   when q."endedAt" is null and (campus_private.settings(qid)->>'teacherActive')::boolean
     and mine is not null and not (mine->>'previousSession')::boolean and mine->>'status' in ('waiting','called') then
     jsonb_build_object('roster',(select coalesce(jsonb_agg(jsonb_build_object(
       'seq',t->'seq','number',t->'number','name',t->'name','status',t->'status'
     ) order by case when t->>'status'='called' then 0 else 1 end,(t->>'queueOrder')::int,(t->>'seq')::int),'[]'::jsonb) from jsonb_array_elements(all_t) t where t->>'status' in ('waiting','called')))
   else '{}'::jsonb end;
end;
$function$;

CREATE OR REPLACE FUNCTION campus_private.publish(qid text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare snap jsonb; states jsonb; rev bigint;
begin
 update campus_private.queues set revision=revision+1 where id=qid returning revision into rev;
 snap:=campus_private.snapshot(qid);
 select coalesce(jsonb_agg(jsonb_build_object('seq',t.seq,'queueOrder',t."queueOrder",'number',t.number,'status',t.status,'calledAt',t."calledAt",'finishedAt',t."finishedAt") order by case when t.status='called' then 0 else 1 end,t."queueOrder",t.seq),'[]'::jsonb)
 into states from campus_private.tickets t join campus_private.queues q on q.id=t."queueId" and q.generation=t.generation where q.id=qid;
 snap:=(snap-'mine'-'admission'-'canShare')||jsonb_build_object('states',states);
 insert into public.campus_queue_live(queue_id,revision,snapshot) values(qid,rev,snap)
 on conflict(queue_id) do update set revision=excluded.revision,snapshot=excluded.snapshot,updated_at=clock_timestamp();
end;
$function$;

CREATE OR REPLACE FUNCTION public.campus_api(p_method text, p_path text, p_credentials jsonb, p_body jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 vh text:=p_credentials->>'visitorHash'; sh text:=p_credentials->>'adminHash'; dh text:=p_credentials->>'displayHash';
 a campus_private.users; target campus_private.users; q campus_private.queues; t campus_private.tickets; g campus_private.grants;
 qid text; parts text[]:=string_to_array(trim(both '/' from p_path),'/'); is_admin boolean:=false;
 result jsonb; claims jsonb; payload text; signature text; secret text; issuer text; issuer_kind text; raw_invite text;
 now_ms bigint; invite_seconds int; seq_no int; order_no int; ordered_ids text[]; reordered_ids text[]; before_id text; new_id text; session_token text; queue_row record;
begin
 if p_path='/health' and p_method='GET' then return jsonb_build_object('ok',true,'version',3,'backend','supabase'); end if;
 if p_path='/admin/login' and p_method='POST' then
  select * into a from campus_private.users where username=lower(p_body->>'username') and active and "passwordHash"=p_body->>'_verifiedHash' for update;
  if not found then perform campus_private.fail(401,'Неверный логин или пароль, либо аккаунт отключён.'); end if;
  return jsonb_build_object('token',campus_private.new_session(a.id),'user',campus_private.safe_user(a));
 end if;
 if parts[1]='admin' then a:=campus_private.actor(sh); is_admin:=true; end if;
 if p_path='/admin/password' and p_method='POST' then
  select * into target from campus_private.users where id=a.id for update;
  -- Recheck the session after waiting for a concurrent reset or password change.
  a:=campus_private.actor(sh);
  if target."passwordHash" is distinct from p_body->>'_verifiedHash' then
   perform campus_private.fail(400,'Пароль уже изменён. Введите текущий пароль.');
  end if;
  if coalesce(p_body->>'_hash','') !~ '^[a-f0-9]{32}:[a-f0-9]{128}$' then
   perform campus_private.fail(400,'Некорректный пароль.');
  end if;
  update campus_private.users set "passwordHash"=p_body->>'_hash',"passwordChangeSuggested"=false where id=a.id returning * into a;
  delete from campus_private.sessions where "userId"=a.id and "tokenHash"<>sh;
  return jsonb_build_object('user',campus_private.safe_user(a));
 end if;
 if p_path='/admin/me' and p_method='GET' then return jsonb_build_object('user',campus_private.safe_user(a)); end if;
 if p_path='/admin/logout' and p_method='POST' then delete from campus_private.sessions where "tokenHash"=sh; return jsonb_build_object('ok',true); end if;
 -- A temporary password permits only inspection, replacement and logout.
 if is_admin and a."passwordChangeSuggested" then
  perform campus_private.fail(403,'Сначала задайте свой пароль вместо временного.');
 end if;
 if p_path='/admin/network' and p_method='GET' then return jsonb_build_object('addresses','[]'::jsonb); end if;
 if p_path='/me/tickets' and p_method='GET' then
  select coalesce(jsonb_agg((to_jsonb(x)-'visitorHash')||jsonb_build_object('queue',campus_private.settings(x."queueId")) order by x."createdAt" desc),'[]'::jsonb) into result
   from (select distinct on ("queueId") * from campus_private.tickets where "visitorHash"=vh order by "queueId",generation desc,seq desc limit 30) x;
  return jsonb_build_object('tickets',result,'serverNow',campus_private.ms());
 end if;
 if p_path='/admin/queues' then
  if p_method='GET' then
   select coalesce(jsonb_agg(campus_private.settings(x.id)||jsonb_build_object('waiting',(select count(*) from campus_private.tickets where "queueId"=x.id and generation=x.generation and status='waiting')) order by x."createdAt" desc),'[]'::jsonb) into result
   from campus_private.queues x where x."endedAt" is null and (a.role='owner' or x."ownerId"=a.id);
   return jsonb_build_object('queues',result);
  elsif p_method='POST' then
   insert into campus_private.queues("ownerId",title,room,status,"avgMinutes","maxQueue","qrIntervalSeconds") values(a.id,p_body->>'title',p_body->>'room',coalesce(p_body->>'status','open'),coalesce((p_body->>'avgMinutes')::int,5),coalesce((p_body->>'maxQueue')::int,60),coalesce((p_body->>'qrIntervalSeconds')::int,60)) returning id into new_id;
   perform campus_private.publish(new_id); return jsonb_build_object('queue',campus_private.settings(new_id));
  end if;
 end if;
 if parts[1]='admin' and parts[2]='teachers' then
  if a.role<>'owner' then perform campus_private.fail(403,'Это действие доступно только владельцу.'); end if;
  if array_length(parts,1)=2 and p_method='GET' then
   select coalesce(jsonb_agg(campus_private.safe_user(u) order by name),'[]'::jsonb) into result from campus_private.users u where role='teacher'; return jsonb_build_object('teachers',result);
  elsif array_length(parts,1)=2 and p_method='POST' then
   if exists(select 1 from campus_private.users where username=p_body->>'username') then perform campus_private.fail(409,'Этот логин уже занят.'); end if;
   insert into campus_private.users(username,name,role,"passwordHash","passwordChangeSuggested") values(p_body->>'username',p_body->>'name','teacher',p_body->>'_hash',true) returning * into target;
   return jsonb_build_object('user',campus_private.safe_user(target),'password',p_body->>'_password');
  elsif array_length(parts,1)=3 and p_method='PATCH' then
   select * into target from campus_private.users where id=parts[3] and role='teacher' for update;
   if not found then perform campus_private.fail(404,'Преподаватель не найден.'); end if;
   update campus_private.users set "passwordChangeSuggested"=case when p_body->>'resetPassword'='true' then true else "passwordChangeSuggested" end,active=coalesce((p_body->>'active')::boolean,active),"passwordHash"=case when p_body->>'resetPassword'='true' then p_body->>'_hash' else "passwordHash" end where id=target.id returning * into target;
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
 -- Completion is serialized with joins and teacher actions on this queue row.
 if is_admin and p_method='POST' and array_length(parts,1)=4 and parts[4]='end' then
  if p_body->>'confirmation' is distinct from 'ЗАВЕРШИТЬ' then perform campus_private.fail(400,'Подтвердите завершение очереди.'); end if;
  if (p_body->>'generation')::int is distinct from q.generation then perform campus_private.fail(409,'Пара изменилась. Откройте подтверждение заново.'); end if;
  if q."endedAt" is not null then return jsonb_build_object('ok',true); end if;
  update campus_private.queues set status='closed',"endedAt"=clock_timestamp() where id=qid;
  update campus_private.tickets set status='cancelled',"finishedAt"=clock_timestamp() where "queueId"=qid and status in ('waiting','called');
  update campus_private.grants set "expiresAt"=0 where "queueId"=qid and "consumedTicketId" is null;
  delete from campus_private.sessions where "queueId"=qid and kind='display';
  perform campus_private.publish(qid);
  return jsonb_build_object('ok',true);
 end if;
 if q."endedAt" is not null then perform campus_private.fail(410,'Очередь завершена.'); end if;

 -- Only an owned, completed attempt from this class can authorize a retake.
 if not is_admin and parts[1]='queues' and p_method='POST' and array_length(parts,1)=3 and parts[3]='retake' then
  if (p_body->>'generation')::int is distinct from q.generation then perform campus_private.fail(409,'Началась новая пара. Нужен свежий QR или ссылка.'); end if;
  select * into t from campus_private.tickets where id=p_body->>'ticketId' and "queueId"=qid and generation=q.generation and "visitorHash"=vh;
  if t.id is null then perform campus_private.fail(403,'Для пересдачи нужен ваш талон этой пары.'); end if;
  if t.status<>'done' then perform campus_private.fail(409,'Записаться на пересдачу можно после завершения приёма.'); end if;
  -- One child per attempt makes double taps, retries and delayed requests idempotent.
  if exists(select 1 from campus_private.tickets where "retryOf"=t.id)
   or exists(select 1 from campus_private.tickets where "queueId"=qid and "visitorHash"=vh and status in ('waiting','called')) then
   return campus_private.snapshot(qid,vh);
  end if;
  if exists(select 1 from campus_private.tickets where "queueId"=qid and generation=q.generation and "visitorHash"=vh and seq>t.seq) then
   perform campus_private.fail(409,'У вас уже есть более новый талон. Обновите страницу.');
  end if;
  perform campus_private.require_open(q);
  if (select count(*) from campus_private.tickets where "queueId"=qid and generation=q.generation and status in ('waiting','called'))>=q."maxQueue" then
   perform campus_private.fail(409,'Очередь заполнена. Попробуйте, когда освободится место.');
  end if;
  select coalesce(max(seq),0)+1,coalesce(max("queueOrder"),0)+1 into seq_no,order_no from campus_private.tickets where "queueId"=qid and generation=q.generation;
  insert into campus_private.tickets("queueId",generation,seq,number,"visitorHash",name,"studentGroup",status,"queueOrder","retryOf",attempt)
   values(qid,q.generation,seq_no,'A-'||lpad(seq_no::text,greatest(3,length(seq_no::text)),'0'),vh,t.name,'','waiting',order_no,t.id,t.attempt+1);
  perform campus_private.publish(qid);
  return campus_private.snapshot(qid,vh);
 end if;
 -- Move one waiting student relative to another. Concurrent joins/other moves are preserved.
 if is_admin and p_method='POST' and array_length(parts,1)=4 and parts[4]='reorder' then
  if (p_body->>'generation')::int is distinct from q.generation then perform campus_private.fail(409,'Пара изменилась. Обновите очередь.'); end if;
  before_id:=p_body->>'beforeTicketId';
  select coalesce(array_agg(id order by "queueOrder",seq),'{}'::text[]) into ordered_ids
   from campus_private.tickets where "queueId"=qid and generation=q.generation and status='waiting';
  if not coalesce((p_body->>'ticketId')=any(ordered_ids),false) or (before_id is not null and not(before_id=any(ordered_ids))) then
   perform campus_private.fail(409,'Список изменился: студент уже не ожидает. Обновите очередь.');
  end if;
  if p_body->>'ticketId'=before_id then return campus_private.snapshot(qid,null,true); end if;
  reordered_ids:=array_remove(ordered_ids,p_body->>'ticketId');
  if before_id is null then reordered_ids:=array_append(reordered_ids,p_body->>'ticketId');
  else
   order_no:=array_position(reordered_ids,before_id);
   reordered_ids:=reordered_ids[1:order_no-1]||array[p_body->>'ticketId']||reordered_ids[order_no:cardinality(reordered_ids)];
  end if;
  update campus_private.tickets t1 set "queueOrder"=r.ord
   from unnest(reordered_ids) with ordinality r(id,ord) where t1.id=r.id;
  perform campus_private.publish(qid);
  return campus_private.snapshot(qid,null,true);
 end if;

 -- Manual entry uses the same queue lock, numbering, capacity and service flow.
 if is_admin and p_method='POST' and array_length(parts,1)=4 and parts[4]='tickets' then
  if (p_body->>'generation')::int is distinct from q.generation then
   perform campus_private.fail(409,'Пара изменилась. Откройте запись заново.');
  end if;
  new_id:='manual-'||(p_body->>'requestId');
  select * into t from campus_private.tickets where id=new_id;
  if found then
   if t."queueId"<>qid or t.generation<>q.generation or t.name is distinct from p_body->>'name' then
    perform campus_private.fail(409,'Эта запись уже использована. Откройте форму заново.');
   end if;
   return jsonb_build_object('ticket',to_jsonb(t)-'visitorHash');
  end if;
  perform campus_private.require_open(q);
  if (select count(*) from campus_private.tickets where "queueId"=qid and generation=q.generation and status in ('waiting','called'))>=q."maxQueue" then
   perform campus_private.fail(409,'Очередь заполнена. Попробуйте, когда освободится место.');
  end if;
  select coalesce(max(seq),0)+1,coalesce(max("queueOrder"),0)+1 into seq_no,order_no from campus_private.tickets where "queueId"=qid and generation=q.generation;
  insert into campus_private.tickets(id,"queueId",generation,seq,number,"visitorHash",name,"studentGroup",status,"queueOrder")
   values(new_id,qid,q.generation,seq_no,'A-'||lpad(seq_no::text,greatest(3,length(seq_no::text)),'0'),encode(extensions.gen_random_bytes(32),'hex'),p_body->>'name','','waiting',order_no) returning * into t;
  perform campus_private.publish(qid);
  return jsonb_build_object('ticket',to_jsonb(t)-'visitorHash');
 end if;
 if (p_method='GET' and parts[array_length(parts,1)]='invite') or (is_admin and p_method='POST' and array_length(parts,1)=4 and parts[4]='invite-link') then
  perform campus_private.require_open(q);
  invite_seconds:=q."qrIntervalSeconds";
  if p_method='POST' then
   if (p_body->>'generation')::int is distinct from q.generation then perform campus_private.fail(409,'Пара изменилась. Откройте создание ссылки заново.'); end if;
   invite_seconds:=(p_body->>'intervalSeconds')::int;
   if invite_seconds is null or invite_seconds<60 or invite_seconds>600 or invite_seconds%60<>0 then perform campus_private.fail(400,'Срок ссылки: от 1 до 10 целых минут.'); end if;
  end if;
  if is_admin or parts[1]='display' then issuer_kind:='session'; issuer:=case when is_admin then sh else dh end;
  else
   select id into issuer from campus_private.tickets where "queueId"=qid and generation=q.generation and "visitorHash"=vh and status in ('waiting','called'); issuer_kind:='ticket';
   if issuer is null then perform campus_private.fail(403,'Показать QR может только студент с активным талоном этой пары.'); end if;
  end if;
  now_ms:=campus_private.ms();
  claims:=jsonb_build_object('q',qid,'g',q.generation,'kind',issuer_kind,'issuer',issuer,'iat',now_ms,'exp',now_ms+invite_seconds*1000);
  payload:=encode(convert_to(claims::text,'UTF8'),'hex'); select value into secret from campus_private.meta where key='invite_secret';
  signature:=encode(extensions.hmac(payload,secret,'sha256'),'hex');
  return jsonb_build_object('invite',payload||'.'||signature,'expiresAt',claims->'exp','serverNow',now_ms,'intervalMs',invite_seconds*1000);
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
  if (claims->>'g')::int<>q.generation or now_ms>=(claims->>'exp')::bigint or now_ms<(claims->>'iat')::bigint then perform campus_private.fail(410,'Приглашение устарело. Попросите новую ссылку или отсканируйте свежий QR.'); end if;
  perform campus_private.require_open(q);
  if not campus_private.issuer_valid(claims,q) then perform campus_private.fail(410,'Приглашение отозвано. Попросите новую ссылку или QR.'); end if;
  insert into campus_private.grants("inviteHash","queueId",generation,"visitorHash","expiresAt") values(encode(extensions.digest(raw_invite,'sha256'),'hex'),qid,q.generation,vh,now_ms+120000) on conflict("inviteHash","visitorHash") do nothing;
  return campus_private.snapshot(qid,vh);
 end if;
 if not is_admin and parts[1]='queues' and p_method='POST' and parts[3]='join' then
  select * into g from campus_private.grants where id=p_body->>'grantId' and "queueId"=qid and "visitorHash"=vh;
  if g."consumedTicketId" is not null or exists(select 1 from campus_private.tickets where "queueId"=qid and "visitorHash"=vh and status in ('waiting','called')) then return campus_private.snapshot(qid,vh); end if;
  perform campus_private.require_open(q);
  if g.id is null or g."expiresAt"<=campus_private.ms() or g.generation<>q.generation then perform campus_private.fail(410,'Время записи истекло. Откройте свежую ссылку или отсканируйте QR.'); end if;
  if (select count(*) from campus_private.tickets where "queueId"=qid and generation=q.generation and status in ('waiting','called'))>=q."maxQueue" then perform campus_private.fail(409,'Очередь заполнена. Попробуйте, когда освободится место.'); end if;
  select coalesce(max(seq),0)+1,coalesce(max("queueOrder"),0)+1 into seq_no,order_no from campus_private.tickets where "queueId"=qid and generation=q.generation;
  insert into campus_private.tickets("queueId",generation,seq,number,"visitorHash",name,"studentGroup",status,"queueOrder") values(qid,q.generation,seq_no,'A-'||lpad(seq_no::text,greatest(3,length(seq_no::text)),'0'),vh,p_body->>'name',p_body->>'studentGroup','waiting',order_no) returning id into new_id;
  update campus_private.grants set "consumedTicketId"=new_id where id=g.id;
 elsif not is_admin and parts[1]='queues' and p_method='POST' and parts[3]='leave' then
  update campus_private.tickets set status='cancelled',"finishedAt"=clock_timestamp() where "queueId"=qid and "visitorHash"=vh and status in ('waiting','called');
  if not found then perform campus_private.fail(409,'Активного талона нет.'); end if;
 elsif is_admin and p_method='PATCH' and parts[4]='settings' then
  update campus_private.queues set title=coalesce(p_body->>'title',title),room=coalesce(p_body->>'room',room),status=coalesce(p_body->>'status',status),"avgMinutes"=coalesce((p_body->>'avgMinutes')::int,"avgMinutes"),"maxQueue"=coalesce((p_body->>'maxQueue')::int,"maxQueue"),"qrIntervalSeconds"=coalesce((p_body->>'qrIntervalSeconds')::int,"qrIntervalSeconds") where id=qid;
 elsif is_admin and p_method='POST' and parts[4]='next' then
  -- The queue row is locked above. Compare the displayed ticket to prevent double advances.
  if p_body ? 'currentTicketId' then
   update campus_private.tickets set status='done',"finishedAt"=clock_timestamp()
    where id=p_body->>'currentTicketId' and "queueId"=qid and generation=q.generation and status='called';
   if not found then perform campus_private.fail(409,'Текущий студент уже изменился. Обновите очередь.'); end if;
  end if;
  if exists(select 1 from campus_private.tickets where "queueId"=qid and generation=q.generation and status='called') then perform campus_private.fail(409,'Сначала завершите приём текущего студента.'); end if;
  select * into t from campus_private.tickets where "queueId"=qid and generation=q.generation and status='waiting' order by "queueOrder",seq limit 1;
  if t.id is null then
   if not (p_body ? 'currentTicketId') then perform campus_private.fail(409,'Очередь пока пуста.'); end if;
  else
   update campus_private.tickets set status='called',"calledAt"=clock_timestamp() where id=t.id;
  end if;
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
$function$;

-- Keep private functions and the API restricted to the existing service role.
revoke all on function campus_private.snapshot(text,text,boolean),campus_private.publish(text),public.campus_api(text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function campus_private.snapshot(text,text,boolean),campus_private.publish(text),public.campus_api(text,text,jsonb,jsonb) to service_role;
