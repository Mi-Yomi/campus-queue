import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, publishableKey } from "./api";

const client = createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
export function subscribeQueue(id, onSnapshot, onStatus) {
  const channel = client.channel(`queue:${id}:${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "campus_queue_live", filter: `queue_id=eq.${id}` },
      ({ new: row }) => { if (row.snapshot) onSnapshot(row.snapshot); })
    .subscribe(onStatus);
  return () => { client.removeChannel(channel); };
}
