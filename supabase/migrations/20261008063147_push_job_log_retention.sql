-- Bound only this feature's scheduler history on the shared free project.
create or replace function campus_private.push_maintenance() returns void
language plpgsql security invoker set search_path='' as $fn$
begin
 delete from campus_private.push_outbox where expires_at<now()-interval '1 day';
 delete from campus_private.push_subscriptions where updated_at<now()-interval '90 days';
 delete from campus_private.push_transfers where expires_at<now();
 delete from cron.job_run_details where end_time<now()-interval '1 day'
  and jobid in(select jobid from cron.job where jobname in ('campus-push-retry','campus-push-cleanup'));
end $fn$;
