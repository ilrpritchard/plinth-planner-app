// cloud.js — optional Supabase cloud: email accounts + saving designs.
// Loads the Supabase client lazily from a CDN only when configured + used, so
// the planner still runs fully offline when no keys are set.

import { SUPABASE_URL, SUPABASE_ANON_KEY, cloudEnabled } from './config.js';

const SUPABASE_ESM = 'https://esm.sh/@supabase/supabase-js@2.45.0';
let _client = null;

export function isCloud() { return cloudEnabled(); }

async function client() {
  if (!cloudEnabled()) return null;
  if (_client) return _client;
  const { createClient } = await import(/* @vite-ignore */ SUPABASE_ESM);
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return _client;
}

// ----- auth -----
export async function signUp(email, password, meta = {}) {
  const c = await client(); if (!c) throw new Error('Cloud not configured');
  const { data, error } = await c.auth.signUp({ email, password, options: { data: meta } });
  if (error) throw error; return data;
}
export async function signIn(email, password) {
  const c = await client(); if (!c) throw new Error('Cloud not configured');
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error; return data;
}
export async function signOut() {
  const c = await client(); if (!c) return;
  await c.auth.signOut();
}
/** Email a password-reset link. The link returns to THIS page, where
 *  onPasswordRecovery() fires and the UI collects a new password. */
export async function resetPassword(email) {
  const c = await client(); if (!c) throw new Error('Cloud not configured');
  const { error } = await c.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin + location.pathname,
  });
  if (error) throw error;
}
/** Set a new password for the currently-authenticated user (recovery session). */
export async function updatePassword(password) {
  const c = await client(); if (!c) throw new Error('Cloud not configured');
  const { data, error } = await c.auth.updateUser({ password });
  if (error) throw error; return data;
}
/** Fires when the page was opened from a password-reset email link. */
export async function onPasswordRecovery(cb) {
  const c = await client(); if (!c) return;
  c.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') cb(); });
}
export async function currentUser() {
  const c = await client(); if (!c) return null;
  const { data } = await c.auth.getUser();
  return data?.user || null;
}
export async function onAuthChange(cb) {
  const c = await client(); if (!c) return;
  c.auth.onAuthStateChange((_event, session) => cb(session?.user || null));
}
/** The signed-in user's access token (for plain-fetch REST calls), or null. */
export async function authToken() {
  const c = await client(); if (!c) return null;
  const { data } = await c.auth.getSession();
  return data?.session?.access_token || null;
}

// ----- designs (table: public.designs) -----
export async function saveDesign(name, payload, id = null) {
  const c = await client(); if (!c) throw new Error('Cloud not configured');
  const user = await currentUser(); if (!user) throw new Error('Please sign in first');
  const row = { name, data: payload, mode: payload?.mode || 'home', updated_at: new Date().toISOString() };
  if (id) {
    const { data, error } = await c.from('designs').update(row).eq('id', id).select().single();
    if (error) throw error; return data;
  }
  const { data, error } = await c.from('designs').insert({ ...row, user_id: user.id }).select().single();
  if (error) throw error; return data;
}
export async function listDesigns() {
  const c = await client(); if (!c) return [];
  const { data, error } = await c.from('designs').select('id,name,mode,updated_at').order('updated_at', { ascending: false });
  if (error) throw error; return data || [];
}
export async function loadDesign(id) {
  const c = await client(); if (!c) throw new Error('Cloud not configured');
  const { data, error } = await c.from('designs').select('data').eq('id', id).single();
  if (error) throw error; return data?.data || null;
}
export async function deleteDesign(id) {
  const c = await client(); if (!c) throw new Error('Cloud not configured');
  const { error } = await c.from('designs').delete().eq('id', id);
  if (error) throw error;
}
