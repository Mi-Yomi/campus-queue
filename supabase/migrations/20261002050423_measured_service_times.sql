-- Average actual completed service times for the current class only.
create or replace function campus_private.snapshot(qid text, vh text default null, is_admin boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare q campus_private.queues; all_t jsonb; wait_t jsonb; curr jsonb; mine jsonb; adm jsonb; pos int; ahead int; sample_count bigint; average_seconds numeric; total_seconds numeric;
begin
 select * into q from campus_private.queues where id=qid;
 if not found then perform campus_private.fail(404,'Очередь не найдена.'); end if;
 select coalesce(jsonb_agg(to_jsonb(t)-'visitorHash' order by seq),'[]'::jsonb) into all_t
 from campus_private.tickets t where "queueId"=qid and generation=q.generation;
 select count(*),avg(extract(epoch from ("finishedAt"-"calledAt"))),coalesce(sum(extract(epoch from ("finishedAt"-"calledAt"))),0)
 into sample_count,average_seconds,total_seconds from campus_private.tickets
 where "queueId"=qid and generation=q.generation and status='done' and "calledAt" is not null and "finishedAt">"calledAt";
 select coalesce(jsonb_agg(t order by (t->>'seq')::int),'[]'::jsonb) into wait_t from jsonb_array_elements(all_t) t where t->>'status'='waiting';
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
 ) || case when is_admin then jsonb_build_object('tickets',all_t) else '{}'::jsonb end;
end;
$$;

-- Refresh only the public snapshots so connected clients receive measured stats.
do $$ declare q record; begin
 for q in select id from campus_private.queues order by id loop
  perform campus_private.publish(q.id);
 end loop;
end $$;
