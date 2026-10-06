'use strict';
// node --test integrations/github-action-a11y
const test = require('node:test');
const assert = require('node:assert/strict');
const { input, parseUrls, buildRequest, summary, failReason, check } = require('./index.js');

const opts = { token: 'tok', secret: 'sek', threshold: '80', level: 'aa', urls: '/ /koszyk,\n/kontakt', timeout: '30', apiUrl: 'https://watch.example/', interval: 10 };

test('wejścia z env jak w runnerze GitHuba', () => {
  assert.equal(input('api-url', { 'INPUT_API-URL': ' https://x ' }), 'https://x');
  assert.equal(input('token', {}), '');
});

test('ścieżki rozdzielone spacją, przecinkiem i nową linią', () => {
  assert.deepEqual(parseUrls('/ /koszyk,\n/kontakt'), ['/', '/koszyk', '/kontakt']);
  assert.deepEqual(parseUrls(''), []);
});

test('treść zlecenia z commitem i gałęzią', () => {
  const body = buildRequest(opts, { GITHUB_SHA: 'abc', GITHUB_REF_NAME: 'main' });
  assert.deepEqual(body, { threshold: 80, level: 'AA', urls: ['/', '/koszyk', '/kontakt'], commit: 'abc', branch: 'main' });
  assert.equal(buildRequest({ ...opts, urls: '' }, {}).urls, undefined);
});

function fakeFetch(states) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    const body = states.shift();
    return { ok: !body.httpError, status: body.httpError || 200, json: async () => body };
  };
  return { fn, calls };
}

test('zlecenie, odpytywanie i wynik; klucze tylko w nagłówkach', async () => {
  const { fn, calls } = fakeFetch([
    { id: 'r1', status: 'queued', pages: [{}, {}] },
    { id: 'r1', status: 'running' },
    { id: 'r1', status: 'done', score: 92, passed: true },
  ]);
  const slept = [];
  const r = await check(opts, { fetch: fn, sleep: async ms => slept.push(ms), env: {}, log: () => {} });
  assert.equal(r.score, 92);
  assert.equal(calls[0].url, 'https://watch.example/api/public/ci/a11y');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[1].url, 'https://watch.example/api/public/ci/a11y/r1');
  for (const c of calls) {
    assert.equal(c.init.headers['X-Calmfox-Hook'], 'tok');
    assert.equal(c.init.headers['X-Calmfox-Secret'], 'sek');
    assert.ok(!c.url.includes('sek') && !c.url.includes('tok'));
  }
  assert.deepEqual(slept, [10000, 10000]);
});

test('błąd HTTP z komunikatem serwera', async () => {
  const { fn } = fakeFetch([{ httpError: 422, error: 'Strona nie ma modułu' }]);
  await assert.rejects(check(opts, { fetch: fn, sleep: async () => {}, env: {}, log: () => {} }), /HTTP 422: Strona nie ma modułu/);
});

test('przekroczony czas', async () => {
  const { fn } = fakeFetch([{ id: 'r1', status: 'queued' }, { id: 'r1', status: 'running' }, { id: 'r1', status: 'running' }]);
  let t = 0;
  await assert.rejects(
    check({ ...opts, timeout: '15' }, { fetch: fn, sleep: async ms => { t += ms; }, now: () => t, env: {}, log: () => {} }),
    /Brak wyniku po 15 s/,
  );
});

test('podsumowanie: tabela problemów i powód porażki', () => {
  const r = {
    passed: false, score: 61, threshold: 80, level: 'AA', site: 'sklep.pl', critical: 1, criticalNew: 1, issuesTotal: 12,
    issues: [{ rule: 'image-alt', title: 'Obrazki | opis', impact: 'critical', count: 3, pages: 2, new: true }],
    pages: [{ path: '/', checked: true }, { path: '/koszyk', checked: false }], reportUrl: 'https://watch.example/app/accessibility?site=1',
  };
  const md = summary(r);
  assert.match(md, /❌ Dostępność cyfrowa: 61\/100/);
  assert.match(md, /\| krytyczny \| Obrazki \\\| opis \| `image-alt` \| 3 \| 2 \| nowy \|/);
  assert.match(md, /i 11 więcej w panelu/);
  assert.match(md, /Nie udało się sprawdzić: `\/koszyk`/);
  assert.equal(failReason(r), 'wynik 61 poniżej progu 80, nowe problemy krytyczne: 1');
});
