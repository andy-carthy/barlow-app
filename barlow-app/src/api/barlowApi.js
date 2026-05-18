// Unified API client for all Barlow pipeline endpoints.
// All functions return Promise<{ data: T | null, error: string | null }>.
// Fixture fallback: pass useFallback=true to skip the server and load pre-computed data.

const BASE = 'http://localhost:3001';

async function post(path, body, apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-Anthropic-Key'] = apiKey;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body:   JSON.stringify(body),
  });
  if (!res.ok) return { data: null, error: `HTTP ${res.status}` };
  return res.json();
}

async function loadFixture(name) {
  const res = await fetch(`/fixtures/demo/${name}`);
  if (!res.ok) throw new Error(`Fixture not found: ${name}`);
  return res.json();
}

// ── Phase 1 — Extraction ──────────────────────────────────────────────────────

export async function extract(text, { useFallback = false, apiKey } = {}) {
  if (useFallback) {
    try {
      const data = await loadFixture('carlyle_extraction_output.json');
      return { data: { extraction: data, elapsed_ms: 0 }, error: null };
    } catch (e) {
      return { data: null, error: e.message };
    }
  }
  return post('/api/extract', { text }, apiKey);
}

// ── Phase 2A — Tape Ingestion ─────────────────────────────────────────────────

export async function ingestTape(csv, { useFallback = false } = {}) {
  if (useFallback) {
    try {
      const res = await fetch('/fixtures/demo/carlyle_loan_tape.csv');
      if (!res.ok) throw new Error('carlyle_loan_tape.csv not found');
      const fallbackCsv = await res.text();
      return post('/api/ingest-tape', { csv: fallbackCsv });
    } catch (e) {
      return { data: null, error: e.message };
    }
  }
  return post('/api/ingest-tape', { csv });
}

// ── Phase 2B — Notice Processing ─────────────────────────────────────────────

export async function processNotice(noticeText, positions, { useFallback = false } = {}) {
  if (useFallback) {
    try {
      const data = await loadFixture('carlyle_notice_results.json');
      return { data, error: null };
    } catch (e) {
      return { data: null, error: e.message };
    }
  }
  return post('/api/process-notice', { noticeText, positions });
}

// ── Phase 3 — Coverage Tests ──────────────────────────────────────────────────

export async function runTests(extraction, positions, { useFallback = false } = {}) {
  if (useFallback) {
    try {
      const data = await loadFixture('carlyle_coverage_results.json');
      return { data, error: null };
    } catch (e) {
      return { data: null, error: e.message };
    }
  }
  return post('/api/run-tests', { extraction, positions });
}

// ── Phase 4 — Waterfall ───────────────────────────────────────────────────────

export async function runWaterfall(waterfallInput, { useFallback = false } = {}) {
  if (useFallback) {
    try {
      const data = await loadFixture('carlyle_waterfall_ledger.json');
      return { data, error: null };
    } catch (e) {
      return { data: null, error: e.message };
    }
  }
  return post('/api/run-waterfall', waterfallInput);
}

// ── Phase 5A — Report Assembly ────────────────────────────────────────────────

export async function assembleReport(payload, { useFallback = false } = {}) {
  if (useFallback) {
    try {
      const data = await loadFixture('carlyle_trustee_report.json');
      return { data: { report: data, markdown: '' }, error: null };
    } catch (e) {
      return { data: null, error: e.message };
    }
  }
  return post('/api/assemble-report', payload);
}

// ── Deals API (Phase 7) ───────────────────────────────────────────────────────

export async function getDeals() {
  const res = await fetch(`${BASE}/api/deals`);
  if (!res.ok) return { data: null, error: `HTTP ${res.status}` };
  return res.json();
}

export async function createDeal(payload) {
  return post('/api/deals', payload);
}

export async function deleteDeal(dealId) {
  const res = await fetch(`${BASE}/api/deals/${dealId}`, { method: 'DELETE' });
  if (!res.ok) return { data: null, error: `HTTP ${res.status}` };
  return res.json();
}

export async function activateDeal(dealId) {
  const res = await fetch(`${BASE}/api/deals/${dealId}/activate`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) return { data: null, error: `HTTP ${res.status}` };
  return res.json();
}

// ── Phase 5B — Narrative Generation (SSE streaming) ──────────────────────────

// onEvent(event) is called for each SSE event:
//   { type: 'start',    exception_id, ... }
//   { type: 'token',    exception_id, token }
//   { type: 'complete', exception_id, narrative, generated_by, ... }
//   { type: 'done' }
//   { type: 'error',    exception_id, message }
export async function generateNarratives(report, extractionOutput, onEvent, { useFallback = false } = {}) {
  if (useFallback) {
    try {
      const narratives = await loadFixture('carlyle_narratives.json');
      for (const n of narratives) {
        onEvent({ type: 'start',    exception_id: n.exception_id });
        onEvent({ type: 'complete', ...n });
      }
      onEvent({ type: 'done' });
      return { data: narratives, error: null };
    } catch (e) {
      return { data: null, error: e.message };
    }
  }

  const res = await fetch('/api/generate-narratives', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ report, extractionOutput }),
  });

  if (!res.ok) return { data: null, error: `HTTP ${res.status}` };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const narratives = [];
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const event = JSON.parse(line.slice(6));
        onEvent(event);
        if (event.type === 'complete') narratives.push(event);
      } catch {
        // malformed line — skip
      }
    }
  }

  return { data: narratives, error: null };
}
