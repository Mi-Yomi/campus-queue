import webpush from "web-push";
import { validPushEndpoint, deliveryResult } from "../_shared/push-validation.mjs";

const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
async function rpc(name: string, args: Record<string, unknown>) {
  const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args), signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error("Push database request failed");
  return r.json();
}

// Custom server-to-server authentication. The random key lives in Supabase
// Vault; browsers cannot read it or call the service-role-only RPCs below.
Deno.serve(async req => {
  const secret = req.headers.get("X-Queue-Push-Key") || "";
  if (req.method !== "POST" || !/^[a-f0-9]{64}$/.test(secret)) return new Response(null, { status: 401 });
  let config;
  try { config = await rpc("campus_push_worker_config", { p_secret: secret }); }
  catch { return new Response(null, { status: 503 }); }
  if (!config) return new Response(null, { status: 401 });
  if (!config.privateKey) return new Response(null, { status: 503 });
  try {
    const jobs = await rpc("campus_push_claim", {});
    // At most 20 jobs, in groups of 5; each outbound request has a deadline.
    for (let i = 0; i < jobs.length; i += 5) {
      await Promise.all(jobs.slice(i, i + 5).map(async (job: any) => {
        let status = 0;
        try {
          if (!validPushEndpoint(job.subscription.endpoint)) status = 400;
          else {
            const payload = JSON.stringify({ title: "РИТМ — ваша очередь!", body: `${job.number} · ${job.title}. Подходите к преподавателю :3`,
              queueId: job.queueId, tag: `ritm-${job.ticketId}`, expiresAt: job.expiresAt });
            const details = webpush.generateRequestDetails(job.subscription, payload, {
              vapidDetails: { subject: "https://mi-yomi.github.io/campus-queue/", publicKey: config.publicKey, privateKey: config.privateKey },
              TTL: Math.max(1, Math.min(60, Math.floor((job.expiresAt - Date.now()) / 1000))), urgency: "high",
              topic: job.topic, contentEncoding: "aes128gcm",
            });
            const response = await fetch(details.endpoint, { method: "POST", headers: details.headers,
              body: details.body, redirect: "error", signal: AbortSignal.timeout(8000) });
            status = response.status;
            await response.body?.cancel();
          }
        } catch { /* transient network failures are retried from the durable outbox */ }
        await rpc("campus_push_finish", { p_id: job.id, p_lease: job.lease, p_result: deliveryResult(status), p_status: status });
      }));
    }
    return Response.json({ processed: jobs.length });
  } catch {
    // No tokens, endpoints or student data in logs or responses.
    return new Response(null, { status: 503 });
  }
});
