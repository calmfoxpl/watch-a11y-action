'use strict';
// Kontrola dostępności Calmfox Watch w GitHub Actions.
// Bez zależności: Node 20 ma fetch, a wyjścia i podsumowanie to dopisanie do plików,
// które podaje runner. Logika jest w funkcjach eksportowanych do testów (`node --test`).

const fs = require('node:fs');

const IMPACT = { critical: 'krytyczny', serious: 'poważny', moderate: 'umiarkowany', minor: 'drobny' };

/** Wejście akcji tak, jak podaje je runner: INPUT_<NAZWA> wielkimi literami, myślniki zostają. */
function input(name, env = process.env) {
  return (env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] || '').trim();
}

/** Ścieżki z jednego pola: spacje, przecinki i nowe linie jako separatory. */
function parseUrls(raw) {
  return raw.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
}

/** Treść zlecenia — commit i gałąź z kontekstu GitHuba podpisują wynik w panelu. */
function buildRequest(opts, env = process.env) {
  const body = { threshold: Number(opts.threshold), level: opts.level.toUpperCase() };
  const urls = parseUrls(opts.urls || '');
  if (urls.length) body.urls = urls;
  if (env.GITHUB_SHA) body.commit = env.GITHUB_SHA;
  if (env.GITHUB_REF_NAME) body.branch = env.GITHUB_REF_NAME;
  return body;
}

function headers(opts) {
  return {
    'Content-Type': 'application/json',
    'X-Calmfox-Hook': opts.token,
    'X-Calmfox-Secret': opts.secret,
    'User-Agent': 'calmfox-watch-a11y-action',
  };
}

/** Tabela w Markdownie do $GITHUB_STEP_SUMMARY. Tytuły reguł bez znaków, które psują tabelę. */
function summary(r) {
  const cell = s => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ');
  const lines = [
    `## ${r.passed ? '✅' : '❌'} Dostępność cyfrowa: ${r.score ?? '–'}/100`,
    '',
    `Próg **${r.threshold}**, poziom WCAG **${r.level}**, strona \`${r.site}\`. ` +
      `Problemy krytyczne: ${r.critical ?? 0} (nowe: ${r.criticalNew ?? 0}).`,
    '',
  ];
  if (r.issues && r.issues.length) {
    lines.push('| Waga | Problem | Reguła | Elementy | Podstrony | |', '|---|---|---|---:|---:|---|');
    for (const i of r.issues) {
      lines.push(`| ${IMPACT[i.impact] || i.impact} | ${cell(i.title)} | \`${cell(i.rule)}\` | ${i.count} | ${i.pages} | ${i.new ? 'nowy' : ''} |`);
    }
    if (r.issuesTotal > r.issues.length) lines.push('', `…i ${r.issuesTotal - r.issues.length} więcej w panelu.`);
  } else {
    lines.push('Nie znaleźliśmy problemów na sprawdzonych adresach.');
  }
  const missed = (r.pages || []).filter(p => p.checked === false).map(p => `\`${p.path}\``);
  if (missed.length) lines.push('', `Nie udało się sprawdzić: ${missed.join(', ')}.`);
  lines.push('', `[Szczegóły i instrukcje naprawy w panelu](${r.reportUrl})`, '');
  return lines.join('\n');
}

/** Dlaczego nie przeszło — jedno zdanie do ::error. */
function failReason(r) {
  const why = [];
  if (r.score !== null && r.score < r.threshold) why.push(`wynik ${r.score} poniżej progu ${r.threshold}`);
  if (r.criticalNew > 0) why.push(`nowe problemy krytyczne: ${r.criticalNew}`);
  return why.join(', ') || 'kontrola nie przeszła';
}

async function call(fetchFn, url, init) {
  const res = await fetchFn(url, init);
  let data = {};
  try { data = await res.json(); } catch { /* pusta odpowiedź */ }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${data.error || 'brak opisu'}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Zlecenie i odpytywanie do skutku. Zwraca ostatni stan kontroli; czas i odstęp do
 * podstawienia w testach.
 */
async function check(opts, deps = {}) {
  const fetchFn = deps.fetch || fetch;
  const sleep = deps.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const now = deps.now || (() => Date.now());
  const base = opts.apiUrl.replace(/\/+$/, '');
  const log = deps.log || console.log;

  const started = await call(fetchFn, `${base}/api/public/ci/a11y`, {
    method: 'POST', headers: headers(opts), body: JSON.stringify(buildRequest(opts, deps.env || process.env)),
  });
  log(`Kontrola ${started.id} zlecona (${(started.pages || []).length} adresów).`);
  const deadline = now() + Number(opts.timeout) * 1000;
  let state = started;
  while (state.status === 'queued' || state.status === 'running') {
    if (now() >= deadline) {
      const err = new Error(`Brak wyniku po ${opts.timeout} s — kontrola trwa dalej, wynik będzie w panelu.`);
      err.state = state;
      throw err;
    }
    await sleep((opts.interval || 10) * 1000);
    state = await call(fetchFn, `${base}/api/public/ci/a11y/${started.id}`, { headers: headers(opts) });
    log(`Stan: ${state.status}`);
  }
  return state;
}

function setOutput(name, value, env = process.env) {
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  const opts = {
    token: input('token'), secret: input('secret'), threshold: input('threshold') || '80',
    level: input('level') || 'AA', urls: input('urls'), timeout: input('timeout') || '300',
    apiUrl: input('api-url') || 'https://watch.calmfox.net',
  };
  const failOnError = input('fail-on-error') !== 'false';
  for (const s of [opts.token, opts.secret]) if (s) console.log(`::add-mask::${s}`);
  if (!opts.token || !opts.secret) {
    console.log('::error::Brak wejść token i secret — oba są w panelu: Integracje → Po wdrożeniu.');
    process.exitCode = 1;
    return;
  }

  let r;
  try {
    r = await check(opts);
  } catch (e) {
    console.log(`::${failOnError ? 'error' : 'warning'}::Kontrola dostępności: ${e.message}`);
    if (failOnError) process.exitCode = 1;
    return;
  }

  setOutput('check-id', r.id);
  setOutput('score', r.score ?? '');
  setOutput('passed', String(r.passed === true));
  setOutput('report-url', r.reportUrl);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(r));

  if (r.status === 'failed') {
    console.log(`::${failOnError ? 'error' : 'warning'}::Kontrola dostępności nieudana: ${r.error || 'brak opisu'}`);
    if (failOnError) process.exitCode = 1;
    return;
  }
  console.log(`Wynik: ${r.score}/100 (próg ${r.threshold}). Raport: ${r.reportUrl}`);
  if (!r.passed) {
    console.log(`::error::Dostępność cyfrowa nie przeszła: ${failReason(r)}.`);
    process.exitCode = 1;
  }
}

module.exports = { input, parseUrls, buildRequest, summary, failReason, check };

if (require.main === module) {
  main().catch(e => { console.log(`::error::${e.message}`); process.exitCode = 1; });
}
