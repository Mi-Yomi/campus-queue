-- Fixtures and pg_net requests are rolled back: no real students are called.
begin;
set local role service_role;
do $test$
declare
 teacher_id text:=gen_random_uuid()::text;
 qid text:=gen_random_uuid()::text;
 tid text:=gen_random_uuid()::text;
 raw_token text:=encode(extensions.gen_random_bytes(32),'hex');
 vh text; other_vh text:=repeat('b',64);
 sub jsonb:=jsonb_build_object('endpoint','https://fcm.googleapis.com/fcm/send/qa-'||gen_random_uuid()::text,'keys',jsonb_build_object('auth','test','p256dh','test'));
 payload jsonb; result jsonb; job jsonb; job_id bigint; original_called timestamptz:=now(); code text;
begin
 vh:=encode(extensions.digest(raw_token,'sha256'),'hex');
 insert into campus_private.users(id,username,name,role,"passwordHash","passwordChangeSuggested")
 values(teacher_id,'qa_'||teacher_id,'Test teacher','teacher','test-unused',false);
 insert into campus_private.queues(id,"ownerId",title,room) values(qid,teacher_id,'QA Web Push','');
 payload:=jsonb_build_object('subscription',sub);
 begin
  perform public.campus_push_api('subscribe',vh,payload);
  raise exception 'Visitor without a ticket could subscribe';
 exception when sqlstate 'PT403' then null; end;
 insert into campus_private.tickets(id,"queueId",generation,seq,number,"visitorHash",name,"studentGroup",status,"queueOrder")
 values(tid,qid,1,1,'A-001',vh,'Test student','','waiting',1);
 perform public.campus_push_api('subscribe',vh,payload);
 perform public.campus_push_api('subscribe',vh,payload);
 assert (select count(*) from campus_private.push_subscriptions where visitor_hash=vh)=1;
 assert not exists(select 1 from campus_private.push_outbox where ticket_id=tid), 'Enrollment sent a notification';
 begin
  perform public.campus_push_api('unsubscribe',other_vh,jsonb_build_object('endpoint',sub->>'endpoint'));
  raise exception 'Other visitor could unsubscribe';
 exception when sqlstate 'PT403' then null; end;
 update campus_private.tickets set status='called',"calledAt"=original_called where tickets.id=tid;
 update campus_private.tickets set status='called' where tickets.id=tid;
 assert (select count(*) from campus_private.push_outbox where ticket_id=tid)=1, 'Repeated snapshot enqueued twice';
 select o.id into job_id from campus_private.push_outbox o where ticket_id=tid;
 result:=public.campus_push_claim();
 select j into job from jsonb_array_elements(result) j where (j->>'id')::bigint=job_id;
 assert job is not null;
 assert job->>'number'='A-001';
 assert not (job ? 'name' or job ? 'visitorHash');
 assert not exists(select 1 from jsonb_array_elements(public.campus_push_claim()) j where (j->>'id')::bigint=job_id), 'Leased twice';
 perform public.campus_push_finish(job_id,gen_random_uuid(),'sent',201);
 assert (select finished_at is null from campus_private.push_outbox o where o.id=job_id), 'Wrong lease finished a job';
 perform public.campus_push_finish(job_id,(job->>'lease')::uuid,'retry',503);
 update campus_private.push_outbox o set next_at=now()-interval '1 second' where o.id=job_id;
 result:=public.campus_push_claim();
 select j into job from jsonb_array_elements(result) j where (j->>'id')::bigint=job_id;
 assert job is not null, 'Transient failure was not retried';
 perform public.campus_push_finish(job_id,(job->>'lease')::uuid,'sent',201);
 assert (select o.result='sent' and o.attempts=2 from campus_private.push_outbox o where o.id=job_id);
 update campus_private.tickets set status='waiting',"calledAt"=null where tickets.id=tid;
 update campus_private.tickets set status='called',"calledAt"=original_called+interval '1 second' where tickets.id=tid;
 update campus_private.tickets set status='done' where tickets.id=tid;
 perform public.campus_push_claim();
 assert not exists(select 1 from campus_private.push_outbox where ticket_id=tid and finished_at is null), 'Completed call stayed pending';
 result:=public.campus_push_api('transfer-create',vh,jsonb_build_object('token',raw_token));
 code:=result->>'code';
 assert length(code)=16;
 assert (public.campus_push_api('transfer-claim',other_vh,jsonb_build_object('code',code))->>'token')=raw_token;
 begin
  perform public.campus_push_api('transfer-claim',other_vh,jsonb_build_object('code',code));
  raise exception 'Transfer code reused';
 exception when sqlstate 'PT410' then null; end;
 assert (select "visitorHash"=vh and status='done' from campus_private.tickets where tickets.id=tid), 'Transfer mutated the queue';
 assert public.campus_push_worker_config('invalid') is null;
 perform public.campus_push_api('unsubscribe',vh,jsonb_build_object('endpoint',sub->>'endpoint'));
 assert not exists(select 1 from campus_private.push_outbox where ticket_id=tid), 'Unsubscribe left pending notifications';
end $test$;
rollback;
