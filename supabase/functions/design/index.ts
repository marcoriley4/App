// Design studio server (Supabase Edge Function "design").
// The browser never sees the AI key. This function:
//  1. checks the caller may use the studio on this job (their own job, or office/sales on theirs),
//  2. calls Google's Gemini image model with the GEMINI_API_KEY secret,
//  3. stores pictures in the private job-files bucket and returns short-lived links.
// Deploy:  supabase functions deploy design
// Secret:  supabase secrets set GEMINI_API_KEY=...   (optional: DESIGN_MODEL, DESIGN_DAILY_LIMIT)
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { decodeBase64, encodeBase64 } from 'jsr:@std/encoding@1/base64';

const BUCKET = 'job-files';
const MODEL = Deno.env.get('DESIGN_MODEL') || 'gemini-2.5-flash-image';
const DAILY_LIMIT = Number(Deno.env.get('DESIGN_DAILY_LIMIT') || 40); // AI pictures per job per day: caps the bill
const MAX_BYTES = 8 * 1024 * 1024;
// Sign-up "dream" previews happen before the customer has an account, so they're capped per visitor and per day overall.
const DREAMS_PER_VISITOR = Number(Deno.env.get('DREAMS_PER_VISITOR') || 8);
const DREAMS_PER_DAY = Number(Deno.env.get('DREAMS_PER_DAY') || 300);
// Same looks as data.js STYLE_ROOMS: the server builds the request, so a visitor can't ask for anything else.
const LOOKS: Record<string, [string, string, string]> = {
  'kitchen/modern': ['kitchen', 'Modern', 'Flat white cabinets, black hardware, quartz counters'],
  'kitchen/farmhouse': ['kitchen', 'Farmhouse', 'White shaker cabinets, wood accents, apron sink'],
  'kitchen/classic': ['kitchen', 'Classic warm', 'Wood cabinets, cream counters, traditional trim'],
  'bathroom/spa': ['bathroom', 'Modern spa', 'Walk-in glass shower, floating vanity, large tile'],
  'bathroom/farmhouse': ['bathroom', 'Farmhouse', 'Shaker vanity, subway tile, black fixtures'],
  'bathroom/classic': ['bathroom', 'Classic', 'Tub and shower, wood vanity, warm tones'],
  'living/modern': ['living room', 'Modern', 'Clean lines, light walls, big windows'],
  'living/farmhouse': ['living room', 'Farmhouse', 'Shiplap wall, wood beams, cozy colors'],
  'living/classic': ['living room', 'Traditional', 'Fireplace with mantel, crown molding, rich colors'],
  'bedroom/modern': ['bedroom', 'Calm modern', 'Soft gray walls, simple lines, wood floor'],
  'bedroom/farmhouse': ['bedroom', 'Cozy farmhouse', 'Board-and-batten wall, warm wood, soft whites'],
  'bedroom/classic': ['bedroom', 'Classic', 'Wainscoting, deep color, traditional trim'],
  'basement/family': ['basement', 'Family room', 'Open space, sectional, bright lighting'],
  'basement/theater': ['basement', 'Home theater', 'Dark walls, big screen, theater seats'],
  'basement/guest': ['basement', 'Guest suite', 'Bedroom corner, bath nearby, warm and finished'],
  'garage/clean': ['garage', 'Clean & simple', 'Painted walls, epoxy floor, bright lights'],
  'garage/workshop': ['garage', 'Workshop', 'Workbench, pegboard, tool storage'],
  'garage/showroom': ['garage', 'Showroom', 'Gray flake floor, slat wall, cabinets'],
};
const dreamRequest = (key: string, extra: string) => { const [room, name, desc] = LOOKS[key];
  return `Redesign this ${room} in the ${name} style: ${desc}.${extra.trim() ? ' Also: ' + extra.trim().slice(0, 200) + '.' : ''}`; };
async function callGemini(key: string, mime: string, bytes: Uint8Array, text: string) {
  const ai = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: encodeBase64(bytes) } }, { text }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
  });
  const out = await ai.json().catch(() => ({}));
  if (!ai.ok) { console.error('Gemini error', ai.status, JSON.stringify(out).slice(0, 500)); throw Object.assign(new Error('The AI service had a problem. Please try again in a minute.'), { status: 502 }); }
  const parts = out?.candidates?.[0]?.content?.parts || [];
  const img = parts.map((p: Record<string, Record<string, string>>) => p.inlineData || p.inline_data).find((x: Record<string, string>) => x && x.data);
  if (!img) { const said = parts.map((p: Record<string, string>) => p.text).filter(Boolean).join(' ').slice(0, 200);
    throw Object.assign(new Error(said ? `The AI couldn’t make that picture: ${said}` : 'The AI didn’t send back a picture. Try again.'), { status: 422 }); }
  return { mime: img.mimeType || img.mime_type || 'image/png', data: img.data as string };
}
const TRADES: Record<string, string> = {
  plumbing: 'Plumbing', electrical: 'Electrical', roofing: 'Roofing', hvac: 'Heating & AC', painting: 'Painting',
  drywall: 'Drywall', flooring: 'Flooring', remodel: 'Remodel', landscaping: 'Landscaping', concrete: 'Concrete', decks: 'Decks & patios',
  fencing: 'Fencing', siding: 'Siding', windows: 'Windows & doors', other: 'Home project',
};
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
const fail = (msg: string, status = 400) => reply({ error: msg }, status);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Same wording as the preview (data.js designPrompt), so both behave alike.
function designPrompt(trade: string, description: string, earlier: string[], request: string) {
  return [
    'You are a photorealistic home remodeling visualizer for a contracting company.',
    'Edit the attached photo of the customer\'s space to show the remodel they describe.',
    'Keep the same room, camera angle, walls, windows, doors, ceiling and lighting unless they ask to change them. Make it look like a real photo of finished, buildable work with real materials. No text, labels or people in the picture.',
    trade ? `Type of project: ${trade}.` : '',
    description ? `What they told us about the job: ${description.slice(0, 600)}` : '',
    earlier.length ? `Changes already made in this picture: ${earlier.join(' | ').slice(0, 1500)}` : '',
    `Now make this change: ${request}`,
  ].filter(Boolean).join('\n');
}

function parseDataUrl(s: string) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(s || ''));
  if (!m) throw new Error('That picture couldn’t be read. Try a JPG or PNG photo.');
  const bytes = decodeBase64(m[2]);
  if (bytes.length > MAX_BYTES) throw new Error('That picture is too big. Try a smaller photo.');
  return { mime: m[1], bytes };
}
const extOf = (mime: string) => (mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Use POST.', 405);
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return fail('Please log in.', 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return fail('Bad request.'); }

  // Sign-up preview: their photo in the look they picked. Nothing is saved; capped per visitor and per day.
  if (body.action === 'dream') {
    const key = Deno.env.get('GEMINI_API_KEY');
    if (!key) return fail('Picture previews aren’t turned on yet. We’ll still see the look you picked.', 503);
    const style = String(body.style || ''); const words = String(body.extra || '').trim().slice(0, 400);
    if (!LOOKS[style] && words.length < 3) return fail('Tell us what you want it to look like.');
    let img;
    try { img = parseDataUrl(body.image); } catch (e) { return fail((e as Error).message); }
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
    const visitor = encodeBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + (Deno.env.get('SUPABASE_URL') || ''))))).slice(0, 24);
    const since = new Date(Date.now() - 86400e3).toISOString();
    const { count: mine } = await admin.from('design_dreams').select('id', { count: 'exact', head: true }).eq('visitor', visitor).gte('created_at', since);
    if ((mine || 0) >= DREAMS_PER_VISITOR) return fail('That’s all the previews for today. Send your request and your project manager will make more with you.', 429);
    const { count: all } = await admin.from('design_dreams').select('id', { count: 'exact', head: true }).gte('created_at', since);
    if ((all || 0) >= DREAMS_PER_DAY) return fail('Picture previews are busy right now. Send your request and we’ll make yours with you.', 429);
    await admin.from('design_dreams').insert({ visitor });
    try {
      const tradeLabel = TRADES[String(body.trade || '')] || 'Home project';
      const request = LOOKS[style] ? dreamRequest(style, words.slice(0, 200)) : `Show this ${tradeLabel.toLowerCase()} project finished the way the customer wants: ${words}.`;
      const out = await callGemini(key, img.mime, img.bytes, designPrompt(LOOKS[style] ? 'Remodel' : tradeLabel, '', [], request));
      return reply({ image: `data:${out.mime};base64,${out.data}` });
    } catch (e) { return fail((e as Error).message, (e as { status?: number }).status || 500); }
  }

  const job = String(body.job || '');
  if (!uuid.test(job)) return fail('Job not found.', 404);

  const { data: userData } = await asUser.auth.getUser();
  const user = userData?.user;
  if (!user) return fail('Please log in.', 401);
  const { data: allowed, error: accessErr } = await asUser.rpc('can_design', { p_job: job });
  if (accessErr || !allowed) return fail('Job not found.', 404);
  const { data: prof } = await admin.from('profiles').select('name').eq('id', user.id).maybeSingle();
  const byName = prof?.name || 'Customer';

  const withUrls = async (rows: Record<string, unknown>[]) => {
    if (!rows.length) return [];
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.path as string), 3600);
    const urlBy = Object.fromEntries((signed || []).map((s) => [s.path, s.signedUrl]));
    const { data: savedRows } = await admin.from('job_files').select('design_id').eq('job_id', job).eq('source', 'design');
    const savedIds = new Set((savedRows || []).map((x) => x.design_id));
    return rows.map((r) => ({ id: r.id, parent_id: r.parent_id, source: r.source, prompt: r.prompt, by_name: r.by_name, chosen: r.chosen, created_at: r.created_at, saved: savedIds.has(r.id), url: urlBy[r.path as string] || null }));
  };
  const save = async (bytes: Uint8Array, mime: string, row: Record<string, unknown>) => {
    const id = crypto.randomUUID();
    const path = `${job}/design/${id}.${extOf(mime)}`;
    const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
    if (up.error) throw new Error('Couldn’t save the picture. Try again.');
    const { data, error } = await admin.from('design_versions').insert({ id, job_id: job, path, by_name: byName, by_user: user.id, ...row }).select().single();
    if (error) throw new Error('Couldn’t save the picture. Try again.');
    return (await withUrls([data]))[0];
  };

  try {
    switch (body.action) {
      case 'list': {
        const { data } = await admin.from('design_versions').select('*').eq('job_id', job).order('created_at');
        return reply({ versions: await withUrls(data || []) });
      }
      case 'photo': {
        const { mime, bytes } = parseDataUrl(body.image);
        const version = await save(bytes, mime, { source: 'photo', prompt: '' });
        await admin.from('job_events').insert({ job_id: job, text: `🎨 Design studio: photo added by ${byName}` });
        return reply({ version });
      }
      case 'generate': {
        const key = Deno.env.get('GEMINI_API_KEY');
        if (!key) return fail('The AI design studio isn’t turned on yet. Ask the office to add the GEMINI_API_KEY secret.', 503);
        const prompt = String(body.prompt || '').trim().slice(0, 1500);
        if (prompt.length < 3) return fail('Tell us what you want changed.');
        const since = new Date(Date.now() - 86400e3).toISOString();
        const { count } = await admin.from('design_versions').select('id', { count: 'exact', head: true }).eq('job_id', job).eq('source', 'ai').gte('created_at', since);
        if ((count || 0) >= DAILY_LIMIT) return fail(`That’s ${DAILY_LIMIT} pictures today for this job. Try again tomorrow, or call us to talk it through.`, 429);

        const { data: all } = await admin.from('design_versions').select('*').eq('job_id', job);
        const byId = Object.fromEntries((all || []).map((v) => [v.id, v]));
        const from = byId[String(body.from || '')];
        if (!from) return fail('Pick a photo to start from.');
        const earlier: string[] = [];
        for (let v = from; v && v.source === 'ai'; v = byId[v.parent_id]) earlier.unshift(v.prompt);
        const { data: j } = await admin.from('jobs').select('trade, description').eq('id', job).single();
        const file = await admin.storage.from(BUCKET).download(from.path);
        if (file.error || !file.data) return fail('The starting picture is missing. Pick another one.');
        const src = new Uint8Array(await file.data.arrayBuffer());

        const ai = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [
              { inline_data: { mime_type: file.data.type || 'image/jpeg', data: encodeBase64(src) } },
              { text: designPrompt(TRADES[j?.trade] || '', j?.description || '', earlier, prompt) },
            ] }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
          }),
        });
        const out = await ai.json().catch(() => ({}));
        if (!ai.ok) { console.error('Gemini error', ai.status, JSON.stringify(out).slice(0, 500)); return fail('The AI service had a problem. Please try again in a minute.', 502); }
        const parts = out?.candidates?.[0]?.content?.parts || [];
        const img = parts.map((p: Record<string, Record<string, string>>) => p.inlineData || p.inline_data).find((x: Record<string, string>) => x && x.data);
        if (!img) {
          const said = parts.map((p: Record<string, string>) => p.text).filter(Boolean).join(' ').slice(0, 200);
          return fail(said ? `The AI couldn’t make that picture: ${said}` : 'The AI didn’t send back a picture. Try saying it a different way.', 422);
        }
        const mime = img.mimeType || img.mime_type || 'image/png';
        const version = await save(decodeBase64(img.data), mime, { source: 'ai', prompt, parent_id: from.id });
        return reply({ version });
      }
      case 'adopt': {
        // Right after sign-up: their photo and the dream picture they saw, saved on the job as the one they picked.
        const { count } = await admin.from('design_versions').select('id', { count: 'exact', head: true }).eq('job_id', job);
        if ((count || 0) > 0) return fail('This job already has designs.', 409);
        const photo = parseDataUrl(body.photo); const pic = parseDataUrl(body.image);
        const ph = await save(photo.bytes, photo.mime, { source: 'photo', prompt: '' });
        const v = await save(pic.bytes, pic.mime, { source: 'ai', prompt: String(body.prompt || '').slice(0, 1500), parent_id: ph.id, chosen: true });
        await admin.from('job_events').insert({ job_id: job, text: `🌟 ${byName} designed their dream room while signing up` });
        return reply({ version: v });
      }
      case 'save': {
        // Save a design to the job's Photos & papers, shared with everyone on the job, together with the photo
        // it started from (its "before"), so everyone sees where it was and where it's going.
        const id = String(body.id || '');
        const { data: all } = await admin.from('design_versions').select('id, parent_id, source, path, prompt').eq('job_id', job);
        const byId = Object.fromEntries((all || []).map((x) => [x.id, x]));
        const v = byId[id];
        if (!v) return fail('Not found.', 404);
        let root = v; while (root && root.source !== 'photo' && root.parent_id) root = byId[root.parent_id];
        const group = (root || v).id;
        const name = String(body.name || 'Design').replace(/[^\w .&()'-]/g, '').slice(0, 80) || 'Design';
        const keep = async (ver: Record<string, string>, stage: string, label: string) => {
          const { data: had } = await admin.from('job_files').select('id').eq('design_id', ver.id).maybeSingle();
          if (had) return false;
          const ext = String(ver.path).split('.').pop() || 'png';
          const { error } = await admin.from('job_files').insert({ job_id: job, path: ver.path, name: `${label}.${ext}`, mime: ext === 'png' ? 'image/png' : 'image/jpeg', kind: 'photo',
            shared: true, source: 'design', design_id: ver.id, design_group: group, stage, by_name: byName, note: String(ver.prompt || '').slice(0, 500) });
          if (error) throw new Error('Couldn’t save it to the project. Try again.');
          return true;
        };
        const before = root && root.id !== v.id ? await keep(root, 'before', `Before - ${name}`) : false;
        const after = await keep(v, v.source === 'photo' ? 'before' : 'after', `${v.source === 'photo' ? 'Before' : 'After'} - ${name}`);
        if (before || after) await admin.from('job_events').insert({ job_id: job, text: `💾 ${byName} saved ${name}${before ? ' and its before photo' : ''} from the design studio to Photos & papers` });
        return reply({ ok: true });
      }
      case 'unsave': {
        // Take a design out; its before photo goes too unless another saved design still uses it.
        const id = String(body.id || '');
        const { data: f } = await admin.from('job_files').select('id, stage, design_group').eq('job_id', job).eq('design_id', id).eq('source', 'design').maybeSingle();
        if (!f) return reply({ ok: true });
        await admin.from('job_files').delete().eq('id', f.id);
        if (f.stage === 'after' && f.design_group) {
          const { count } = await admin.from('job_files').select('id', { count: 'exact', head: true }).eq('job_id', job).eq('source', 'design').eq('stage', 'after').eq('design_group', f.design_group);
          if (!count) await admin.from('job_files').delete().eq('job_id', job).eq('source', 'design').eq('stage', 'before').eq('design_group', f.design_group);
        }
        await admin.from('job_events').insert({ job_id: job, text: `💾 ${byName} removed a saved design from Photos & papers` });
        return reply({ ok: true });
      }
      case 'choose': {
        const id = String(body.id || '');
        const { data: v } = await admin.from('design_versions').select('id, prompt').eq('job_id', job).eq('id', id).maybeSingle();
        if (!v) return fail('Not found.', 404);
        await admin.from('design_versions').update({ chosen: false }).eq('job_id', job).neq('id', id);
        await admin.from('design_versions').update({ chosen: true }).eq('id', id);
        await admin.from('job_events').insert({ job_id: job, text: `⭐ Design picked by ${byName}${v.prompt ? `: “${String(v.prompt).slice(0, 120)}”` : ''}` });
        return reply({ ok: true });
      }
      default:
        return fail('Unknown action.');
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Something went wrong.');
  }
});
