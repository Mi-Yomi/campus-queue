const { VITE_API_URL: api, VITE_SUPABASE_URL: supabase, VITE_SUPABASE_PUBLISHABLE_KEY: key } = process.env;
if (!!supabase !== !!key) throw new Error("Set both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY");
if (key && !key.startsWith("sb_publishable_")) throw new Error("Only a publishable Supabase key may be used in the frontend");
for (const value of [api, supabase].filter(Boolean)) {
 const u = new URL(value);
 if (u.protocol !== "https:" || u.pathname !== "/" || u.search || u.hash || u.username || u.password)
  throw new Error("Backend URL must be an HTTPS origin without a path or credentials");
}
console.log(supabase ? "Supabase frontend configured" : api ? "External API configured" : "Publishing launch page; backend is not configured yet");
