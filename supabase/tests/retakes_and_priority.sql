-- Run through a trusted database connection. All fixtures are rolled back.
begin;
set local role service_role;
do $test$
declare
 teacher_id text:=gen_random_uuid()::text;
 other_id text:=gen_random_uuid()::text;
 qid text:=gen_random_uuid()::text;
 sh text:=gen_random_uuid()::text;
 other_sh text:=gen_random_uuid()::text;
 vh text:=gen_random_uuid()::text;
 done_id text:=gen_random_uuid()::text;
 called_id text:=gen_random_uuid()::text;
 waiting_a text:=gen_random_uuid()::text;
 waiting_b text:=gen_random_uuid()::text;
 retry_id text; manual_id text; r jsonb; again jsonb; live jsonb; admin jsonb;
begin
 insert into campus_private.users(id,username,name,role,"passwordHash","passwordChangeSuggested") values
  (teacher_id,'qa_'||teacher_id,'Test teacher','teacher','test-only-unused',false),
  (other_id,'qa_'||other_id,'Other test teacher','teacher','test-only-unused',false);
 insert into campus_private.queues(id,"ownerId",title,room) values(qid,teacher_id,'QA retakes and priority','');
 insert into campus_private.sessions("tokenHash","userId","expiresAt") values
  (sh,teacher_id,campus_private.ms()+60000),(other_sh,other_id,campus_private.ms()+60000);
 admin:=jsonb_build_object('adminHash',sh);
 insert into campus_private.tickets(id,"queueId",generation,seq,number,"visitorHash",name,"studentGroup",status,"queueOrder","calledAt","finishedAt") values
  (done_id,qid,1,1,'A-001',vh,'First','','done',1,now()-interval '8 minutes',now()-interval '1 minute'),
  (called_id,qid,1,2,'A-002','qa-called-'||qid,'Second','','called',2,now(),null),
  (waiting_a,qid,1,3,'A-003','qa-a-'||qid,'Third','','waiting',3,null,null),
  (waiting_b,qid,1,4,'A-004','qa-b-'||qid,'Fourth','','waiting',4,null,null);
 r:=public.campus_api('POST','/queues/'||qid||'/retake',jsonb_build_object('visitorHash',vh),jsonb_build_object('ticketId',done_id,'generation',1));
 retry_id:=r->'mine'->>'id';
 assert r->'mine'->>'number'='A-005';
 assert (r->'mine'->>'attempt')::int=2;
 assert (r->'mine'->>'position')::int=3;
 assert (r->'mine'->>'estimatedMinutes')::int=21;
 again:=public.campus_api('POST','/queues/'||qid||'/retake',jsonb_build_object('visitorHash',vh),jsonb_build_object('ticketId',done_id,'generation',1));
 assert again->'mine'->>'id'=retry_id;
 assert (again->'stats'->>'total')::int=5;
 begin
  perform public.campus_api('POST','/queues/'||qid||'/retake',jsonb_build_object('visitorHash','wrong'),jsonb_build_object('ticketId',done_id,'generation',1));
  raise exception 'Wrong visitor was allowed';
 exception when sqlstate 'PT403' then null; end;
 begin
  perform public.campus_api('POST','/admin/queues/'||qid||'/reorder',jsonb_build_object('adminHash',other_sh),jsonb_build_object('ticketId',retry_id,'beforeTicketId',waiting_a,'generation',1));
  raise exception 'Wrong teacher was allowed';
 exception when sqlstate 'PT403' then null; end;
 r:=public.campus_api('POST','/admin/queues/'||qid||'/reorder',admin,jsonb_build_object('ticketId',retry_id,'beforeTicketId',waiting_a,'generation',1));
 assert r->'nextNumbers'='["A-005","A-003","A-004"]'::jsonb;
 assert r->'current'->>'id'=called_id;
 r:=campus_private.snapshot(qid,vh);
 assert (r->'mine'->>'position')::int=1;
 assert (r->'mine'->>'estimatedMinutes')::int=7;
 assert r->'roster'->0->>'number'='A-002';
 assert r->'roster'->1->>'number'='A-005';
 select snapshot into live from public.campus_queue_live where queue_id=qid;
 assert live->'states'->0->>'number'='A-002';
 assert (select s->>'number' from jsonb_array_elements(live->'states') with ordinality x(s,ord) where s->>'status'='waiting' order by ord limit 1)='A-005';
 assert not exists(select 1 from jsonb_array_elements(live->'states') s where s ? 'name' or s ? 'visitorHash' or s ? 'retryOf');
 r:=public.campus_api('POST','/admin/queues/'||qid||'/tickets',admin,jsonb_build_object('requestId',gen_random_uuid()::text,'generation',1,'name','Manual'));
 manual_id:=r->'ticket'->>'id';
 assert (r->'ticket'->>'queueOrder')::int>3;
 r:=public.campus_api('POST','/admin/queues/'||qid||'/reorder',admin,jsonb_build_object('ticketId',waiting_a,'beforeTicketId',null,'generation',1));
 assert r->'nextNumbers'='["A-005","A-004","A-006","A-003"]'::jsonb;
 r:=public.campus_api('POST','/admin/queues/'||qid||'/next',admin,jsonb_build_object('currentTicketId',called_id));
 assert r->'current'->>'id'=retry_id;
 begin
  perform public.campus_api('POST','/admin/queues/'||qid||'/reorder',admin,jsonb_build_object('ticketId',retry_id,'beforeTicketId',waiting_a,'generation',1));
  raise exception 'Called student was moved';
 exception when sqlstate 'PT409' then null; end;
 r:=public.campus_api('POST','/admin/queues/'||qid||'/next',admin,jsonb_build_object('currentTicketId',retry_id));
 again:=public.campus_api('POST','/queues/'||qid||'/retake',jsonb_build_object('visitorHash',vh),jsonb_build_object('ticketId',done_id,'generation',1));
 assert (again->'stats'->>'total')::int=6;
 assert again->'mine'->>'status'='done';
 perform public.campus_api('PATCH','/admin/queues/'||qid||'/settings',admin,'{"status":"paused"}'::jsonb);
 begin
  perform public.campus_api('POST','/queues/'||qid||'/retake',jsonb_build_object('visitorHash',vh),jsonb_build_object('ticketId',retry_id,'generation',1));
  raise exception 'Retake admitted while paused';
 exception when sqlstate 'PT409' then null; end;
 perform public.campus_api('POST','/admin/queues/'||qid||'/end',admin,'{"generation":1,"confirmation":"ЗАВЕРШИТЬ"}'::jsonb);
 begin
  perform public.campus_api('POST','/queues/'||qid||'/retake',jsonb_build_object('visitorHash',vh),jsonb_build_object('ticketId',retry_id,'generation',1));
  raise exception 'Retake admitted after end';
 exception when sqlstate 'PT410' then null; end;
 assert not has_function_privilege('anon','public.campus_api(text,text,jsonb,jsonb)','execute');
 assert not has_table_privilege('anon','campus_private.tickets','select');
end;
$test$;
select 'retakes, priority, realtime privacy and permissions passed; fixtures rolled back' as result;
rollback;
