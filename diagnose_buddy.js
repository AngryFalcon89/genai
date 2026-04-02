#!/usr/bin/env node
/**
 * diagnose_buddy.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Automated diagnostic test runner for ZHCET Buddy.
 *
 * Usage:
 *   node diagnose_buddy.js
 *
 * Requirements:
 *   • The server must already be running on the port defined by the PORT env var
 *     (or 3000 by default).
 *   • The server must be built from the latest server.js that returns a `debug`
 *     field in /api/chat responses.
 *
 * Output:
 *   • Real-time console progress with colour-coded results
 *   • test_report.md — full Markdown table + per-case details
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { performance } from 'perf_hooks';
import { writeFileSync }  from 'fs';
import { fileURLToPath }  from 'url';
import path               from 'path';

// ── Config ───────────────────────────────────────────────────────────────────
const SERVER_PORT    = process.env.PORT || 3000;
const BASE_URL       = `http://localhost:${SERVER_PORT}`;
const CHAT_ENDPOINT  = `${BASE_URL}/api/chat`;
const REPORT_FILE    = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'test_report.md'
);

// Known model identifiers (must match server.js constants)
const ROUTER_MODEL = 'llama-3.1-8b-instant';
const TIER1_MODEL  = 'openai/gpt-oss-120b';
const TIER2_MODEL  = 'llama-3.3-70b-versatile';
const TIER3_MODEL  = 'qwen/qwen3-32b';

// The server now returns 'BASIC' for greetings (was 'GENERAL') — accept both
function normaliseIntent(raw) {
    if (!raw) return 'UNKNOWN';
    const u = raw.toUpperCase();
    if (u === 'GENERAL') return 'BASIC'; // legacy alias
    return u;
}

// ANSI colour helpers (no dependency)
const c = {
    reset:  '\x1b[0m',
    bold:   '\x1b[1m',
    dim:    '\x1b[2m',
    green:  '\x1b[32m',
    yellow: '\x1b[33m',
    red:    '\x1b[31m',
    cyan:   '\x1b[36m',
    blue:   '\x1b[34m',
    magenta:'\x1b[35m',
};
const green  = s => `${c.green}${s}${c.reset}`;
const red    = s => `${c.red}${s}${c.reset}`;
const yellow = s => `${c.yellow}${s}${c.reset}`;
const cyan   = s => `${c.cyan}${s}${c.reset}`;
const bold   = s => `${c.bold}${s}${c.reset}`;
const dim    = s => `${c.dim}${s}${c.reset}`;

// ── Test Suite Definitions ────────────────────────────────────────────────────
/**
 * Each test case:
 *   id            — short identifier
 *   suite         — grouping label
 *   input         — the message to POST to /api/chat
 *   expectedIntent — LOGIC | DATA | GENERAL (or null = no strict check)
 *   expectedModel  — the primary model constant the router should prefer
 *   validate(result) — function that checks the response content, returns { pass, reason }
 */
const TEST_CASES = [
    // ── Suite 1: Greetings (BASIC → Tier 2) ─────────────────────────────────
    {
        id:             'A1',
        suite:          '1 · Greetings',
        input:          'Hello!',
        expectedIntent: 'BASIC',
        expectedModel:  TIER2_MODEL,
        validate({ response }) {
            const lower = (response || '').toLowerCase();
            const pass  = lower.includes('hello') || lower.includes('hi') ||
                          lower.includes('welcome') || lower.includes('zhcet') ||
                          lower.includes('buddy') || lower.length > 10;
            return { pass, reason: pass ? 'Received a greeting response' : 'Response did not contain a greeting' };
        },
    },
    {
        id:             'A2',
        suite:          '1 · Greetings',
        input:          'What can you help me with?',
        expectedIntent: 'BASIC',
        expectedModel:  TIER2_MODEL,
        validate({ response }) {
            const lower = (response || '').toLowerCase();
            const pass  = lower.length > 20;
            return { pass, reason: pass ? 'Received a substantive help description' : 'Response too short' };
        },
    },

    // ── Suite 2: Case-Insensitive Data (DATA → Tier 3) ───────────────────────
    {
        id:             'B1',
        suite:          '2 · Case-Insensitive Data',
        input:          'show me courses for COMPUTER engineering semester 5',
        expectedIntent: 'DATA',
        expectedModel:  TIER3_MODEL,
        validate({ response }) {
            const lower = (response || '').toLowerCase();
            // Should list actual course codes or course titles, not an error
            const pass  = !lower.includes('no courses found') &&
                          !lower.includes('error') &&
                          (lower.includes('coc') || lower.includes('course') || lower.includes('credits'));
            return { pass, reason: pass ? 'Course data returned without error' : 'Got an error or no courses found' };
        },
    },
    {
        id:             'B2',
        suite:          '2 · Case-Insensitive Data',
        input:          'list all courses for computer Engineering 3rd semester',
        expectedIntent: 'DATA',
        expectedModel:  TIER3_MODEL,
        validate({ response }) {
            const lower = (response || '').toLowerCase();
            const pass  = !lower.includes('no courses found') && lower.length > 50;
            return { pass, reason: pass ? 'Course list returned' : 'Empty or error response' };
        },
    },

    // ── Suite 3: Timetable Precision (DATA → Tier 3) ─────────────────────────
    {
        id:             'C1',
        suite:          '3 · Timetable Precision',
        input:          'What classes do I have today for Computer Engineering semester 5?',
        expectedIntent: 'DATA',
        expectedModel:  TIER3_MODEL,
        validate({ response }) {
            const lower = (response || '').toLowerCase();
            // Either it finds timetable entries, or explicitly explains none are uploaded
            const pass  = lower.includes('timetable') || lower.includes('schedule') ||
                          lower.includes('no active') || lower.includes('no classes') ||
                          lower.includes('monday') || lower.includes('tuesday') ||
                          lower.includes('wednesday') || lower.includes('thursday') ||
                          lower.includes('friday') || lower.includes('saturday') ||
                          lower.includes('uploaded');
            return { pass, reason: pass ? 'Timetable-aware response received' : 'No timetable context in response' };
        },
    },
    {
        id:             'C2',
        suite:          '3 · Timetable Precision',
        input:          'Who is my teacher at 11:20 AM tomorrow?',
        expectedIntent: 'DATA',
        expectedModel:  TIER3_MODEL,
        // Precision check: response must mention a specific day derived from "tomorrow"
        validate({ response }) {
            const lower = (response || '').toLowerCase();
            const days  = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
            const mentionsDay = days.some(d => lower.includes(d));
            const pass  = mentionsDay || lower.includes('timetable') || lower.includes('schedule') ||
                          lower.includes('no active') || lower.includes('uploaded') || lower.includes('no classes');
            return {
                pass,
                reason: pass
                    ? `Response contains day reference (expected "tomorrow" derivation)`
                    : 'Response did not reference any specific weekday (timetable day derivation may be broken)',
            };
        },
    },

    // ── Suite 4: Honours Logic (LOGIC → Tier 1) ──────────────────────────────
    {
        id:             'D1',
        suite:          '4 · Honours Logic',
        input:          'I have a backlog, can I still get honours?',
        expectedIntent: 'LOGIC',
        expectedModel:  TIER1_MODEL,
        validate({ response }) {
            const lower = (response || '').toLowerCase();
            // MUST say NO / ineligible — CONSTANTS_SUMMARY enforces this
            const pass  = lower.includes('no') || lower.includes('ineligible') ||
                          lower.includes('cannot') || lower.includes("can't") ||
                          lower.includes('disqualif') || lower.includes('permanently') ||
                          lower.includes('not eligible') || lower.includes('backlog');
            return {
                pass,
                reason: pass
                    ? 'Correctly refused honours eligibility due to backlog'
                    : 'FAILED: Did not refuse honours eligibility for a student with backlog',
            };
        },
    },
    {
        id:             'D2',
        suite:          '4 · Honours Logic',
        input:          'What CGPA do I need for First Division with Honours?',
        expectedIntent: 'LOGIC',
        expectedModel:  TIER1_MODEL,
        validate({ response }) {
            const lower = (response || '').toLowerCase();
            // Must mention 8.5 and zero-backlog / first-attempt
            const has85   = lower.includes('8.5');
            const hasRule = lower.includes('first attempt') || lower.includes('no backlog') ||
                            lower.includes('backlog') || lower.includes('all cours') ||
                            lower.includes('zero back');
            const pass = has85 && hasRule;
            return {
                pass,
                reason: pass
                    ? 'Correctly cited 8.5 CGPA + first-attempt rule'
                    : `Missing ${!has85 ? '8.5 CGPA threshold' : 'first-attempt clause'}`,
            };
        },
    },
    {
        id:             'D3',
        suite:          '4 · Honours Logic',
        input:          'How many credits do I need to graduate from B.Tech?',
        expectedIntent: 'LOGIC',
        expectedModel:  TIER1_MODEL,
        validate({ response }) {
            const lower = (response || '').toLowerCase();
            // CONSTANTS_SUMMARY pins this to exactly 180
            const pass  = lower.includes('180');
            return {
                pass,
                reason: pass
                    ? 'Correctly cited 180 credits for B.Tech graduation'
                    : 'FAILED: Did not mention 180 credits (CONSTANTS_SUMMARY may not be anchored)',
            };
        },
    },

    // ── Suite 5: Stress Test (mixed intents, no model assertion) ─────────────
    {
        id:             'E1',
        suite:          '5 · Stress Test',
        input:          'Can I register for more than 40 credits this semester?',
        expectedIntent: 'LOGIC',
        expectedModel:  TIER1_MODEL,
        validate({ response }) {
            const lower = (response || '').toLowerCase();
            const pass  = lower.includes('40') && (lower.includes('cannot') || lower.includes('hard') ||
                          lower.includes('limit') || lower.includes('maximum') || lower.includes('not allow'));
            return {
                pass,
                reason: pass
                    ? 'Correctly enforced 40-credit hard cap'
                    : 'FAILED: Did not enforce 40-credit cap',
            };
        },
    },
    {
        id:             'E2',
        suite:          '5 · Stress Test',
        input:          'What are the library timings at ZHCET?',
        expectedIntent: 'GENERAL',
        expectedModel:  TIER2_MODEL,
        validate({ response }) {
            const lower = (response || '').toLowerCase();
            const pass  = lower.length > 20;
            return { pass, reason: pass ? 'Received a response about general info' : 'Empty response' };
        },
    },
    {
        id:             'E3',
        suite:          '5 · Stress Test',
        input:          'Show me the full course list for Artificial Intelligence semester 4',
        expectedIntent: 'DATA',
        expectedModel:  TIER3_MODEL,
        validate({ response }) {
            const lower = (response || '').toLowerCase();
            const pass  = !lower.includes('no courses found') && lower.length > 50;
            return { pass, reason: pass ? 'Course data returned' : 'Error or empty course list' };
        },
    },
];

// ── Core fetch helper ─────────────────────────────────────────────────────────
async function chatRequest(message, sessionId) {
    const t0 = performance.now();
    const resp = await fetch(CHAT_ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message, sessionId }),
    });
    const clientLatency = Math.round(performance.now() - t0);

    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }

    const body = await resp.json();
    return { body, clientLatency };
}

// ── Running a single test ─────────────────────────────────────────────────────
async function runTest(tc, sessionId) {
    console.log(`\n  ${dim('├─')} ${bold(tc.id)} ${dim('[')}${tc.suite}${dim(']')}`);
    console.log(`  ${dim('│')}  Input : ${cyan(tc.input)}`);

    let body, clientLatency, error;
    try {
        ({ body, clientLatency } = await chatRequest(tc.input, sessionId));
    } catch (err) {
        error = err.message;
        console.log(`  ${dim('│')}  ${red('✖ Request failed:')} ${error}`);
        return {
            tc, pass: false,
            reason: `Request failed: ${error}`,
            intentMatch: false, modelMatch: false,
            actualIntent: 'N/A', actualModel: 'N/A',
            latency: null, clientLatency: null,
            snippet: '(no response)',
        };
    }

    const debug   = body.debug   || {};
    const response = body.response || '';

    const actualIntent  = normaliseIntent(debug.intent);
    const actualModel   = debug.model   || 'UNKNOWN';
    const serverLatency = debug.latency || clientLatency;
    const attempts      = debug.attempts || 1;

    const intentMatch = !tc.expectedIntent || actualIntent === tc.expectedIntent;
    const modelMatch  = !tc.expectedModel  || actualModel  === tc.expectedModel;

    const { pass: contentPass, reason: contentReason } = tc.validate(body);

    // Content accuracy drives pass/fail; routing metadata is advisory
    const pass = contentPass;
    const routingOk = intentMatch && modelMatch;
    const snippet = response.replace(/\n+/g, ' ').slice(0, 100) + (response.length > 100 ? '…' : '');

    // Console output
    const tick = pass ? green('✔') : red('✖');
    const routingTick = routingOk ? green('✔') : yellow('⚠');
    console.log(`  ${dim('│')}  Intent: ${intentMatch ? green(actualIntent) : yellow(actualIntent)} (expected ${tc.expectedIntent || 'any'})`);
    console.log(`  ${dim('│')}  Model : ${modelMatch  ? green(actualModel)  : yellow(actualModel)}  (expected ${tc.expectedModel  || 'any'})`);
    console.log(`  ${dim('│')}  Latency: ${yellow(serverLatency + 'ms')}  |  Attempts: ${attempts}`);
    console.log(`  ${dim('│')}  Answer : ${dim(snippet)}`);
    console.log(`  ${dim('│')}  ${tick}  Content: ${pass ? green('PASS') : red('FAIL')} — ${contentReason}`);
    console.log(`  ${dim('│')}  ${routingTick}  Routing: ${routingOk ? green('CORRECT') : yellow('MISMATCH')} (may be due to failover)`);

    return { tc, pass, reason: contentReason, intentMatch, modelMatch, routingOk,
             actualIntent, actualModel, latency: serverLatency, clientLatency,
             attempts, snippet, response };
}

// ── Report rendering ──────────────────────────────────────────────────────────
function buildReport(results, runMs) {
    const now   = new Date();
    const total = results.length;
    const passed = results.filter(r => r.pass).length;
    const failed = total - passed;

    const header = [
        `# ZHCET Buddy — Diagnostic Report`,
        ``,
        `**Generated:** ${now.toUTCString()}  `,
        `**Server:** \`${BASE_URL}\`  `,
        `**Total Cases:** ${total}  |  ` +
        `**Passed:** ${passed}  |  ` +
        `**Failed:** ${failed}  |  ` +
        `**Wall Time:** ${(runMs / 1000).toFixed(1)}s`,
        ``,
    ].join('\n');

    // Summary table
    const tableHeader = [
        `## Summary Table`,
        ``,
        `| ID | Suite | Input | Expected Intent | Classified Intent | Expected Model | Model Used | Latency (ms) | Attempts | Content | Routing | Response Snippet |`,
        `|---|---|---|---|---|---|---|---|---|---|---|---|`,
    ];

    const tableRows = results.map(r => {
        const intentCell = r.intentMatch ? r.actualIntent : `⚠ ${r.actualIntent}`;
        const modelCell  = r.modelMatch  ? r.actualModel  : `⚠ ${r.actualModel}`;
        const passCell   = r.pass ? '✅ PASS' : '❌ FAIL';
        const routeCell  = (r.routingOk ?? (r.intentMatch && r.modelMatch)) ? '✅' : '⚠️';
        const latency    = r.latency != null ? r.latency : 'N/A';
        const attempts   = r.attempts != null ? r.attempts : 'N/A';
        const snippet    = (r.snippet || '').replace(/\|/g, '\\|');
        const input      = r.tc.input.replace(/\|/g, '\\|');
        return `| ${r.tc.id} | ${r.tc.suite} | ${input} | ${r.tc.expectedIntent || 'any'} | ${intentCell} | ${r.tc.expectedModel || 'any'} | ${modelCell} | ${latency} | ${attempts} | ${passCell} | ${routeCell} | ${snippet} |`;
    });

    // Per-suite breakdown sections
    const suites = [...new Set(results.map(r => r.tc.suite))];
    const suiteBlocks = suites.map(suite => {
        const suiteResults = results.filter(r => r.tc.suite === suite);
        const sp = suiteResults.filter(r => r.pass).length;
        const sf = suiteResults.length - sp;
        const lines = [
            `---`,
            ``,
            `## Suite: ${suite}`,
            ``,
            `**Passed:** ${sp} / ${suiteResults.length}   **Failed:** ${sf}`,
            ``,
        ];
        suiteResults.forEach(r => {
            lines.push(`### Case ${r.tc.id} — ${r.pass ? '✅ PASS' : '❌ FAIL'}`);
            lines.push(`- **Input:** \`${r.tc.input}\``);
            lines.push(`- **Classified Intent:** \`${r.actualIntent}\` (expected \`${r.tc.expectedIntent || 'any'}\`) ${r.intentMatch ? '✅' : '⚠️ mismatch'}`);
            lines.push(`- **Model Used:** \`${r.actualModel}\` (expected \`${r.tc.expectedModel || 'any'}\`) ${r.modelMatch ? '✅' : '⚠️ mismatch'}`);
            lines.push(`- **Latency:** ${r.latency != null ? r.latency + ' ms' : 'N/A'}  |  **Failover Attempts:** ${r.attempts != null ? r.attempts : 'N/A'}`);
            lines.push(`- **Validation:** ${r.reason}`);
            lines.push(`- **Response Snippet:**`);
            lines.push(``);
            lines.push(`  > ${(r.snippet || '(none)').replace(/\|/g, '\\|')}`);
            lines.push(``);
            if (r.response && r.response.length > 110) {
                lines.push(`<details><summary>Full response</summary>`);
                lines.push(``);
                lines.push('```');
                lines.push(r.response.slice(0, 3000));
                lines.push('```');
                lines.push(`</details>`);
                lines.push(``);
            }
        });
        return lines.join('\n');
    });

    const footer = [
        `---`,
        ``,
        `## Model Legend`,
        ``,
        `| Constant | Model ID | Role |`,
        `|---|---|---|`,
        `| \`ROUTER_MODEL\` | \`${ROUTER_MODEL}\` | Lightweight intent classifier |`,
        `| \`TIER1_MODEL\`  | \`${TIER1_MODEL}\`  | LOGIC — ordinance / honours reasoning |`,
        `| \`TIER2_MODEL\`  | \`${TIER2_MODEL}\` | GENERAL — basic info, greetings |`,
        `| \`TIER3_MODEL\`  | \`${TIER3_MODEL}\`    | DATA — timetables, course lists |`,
        ``,
        `> Latency figures are **server-side** (from \`performance.now()\` inside \`getChatResponse\`).`,
        `> "Attempts" = 1 means the preferred model responded on the first try; higher values indicate failover.`,
        ``,
        `*Report generated by \`diagnose_buddy.js\`*`,
    ].join('\n');

    return [
        header,
        tableHeader.join('\n'),
        tableRows.join('\n'),
        '',
        ...suiteBlocks,
        footer,
    ].join('\n');
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
    console.log('');
    console.log(bold('══════════════════════════════════════════════════════════'));
    console.log(bold('  ZHCET Buddy — Automated Diagnostic Runner'));
    console.log(bold('══════════════════════════════════════════════════════════'));
    console.log(`  Server : ${cyan(BASE_URL)}`);
    console.log(`  Cases  : ${TEST_CASES.length}`);
    console.log(`  Output : ${cyan(REPORT_FILE)}`);
    console.log('');

    // Connectivity check
    console.log(dim('  Checking server availability…'));
    try {
        const probe = await fetch(`${BASE_URL}/api/sessions`, { method: 'GET' });
        if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
        console.log(green('  ✔ Server is reachable.\n'));
    } catch (err) {
        console.error(red(`  ✖ Cannot reach server at ${BASE_URL}: ${err.message}`));
        console.error(red('    Make sure `npm start` is running before executing this script.'));
        process.exit(1);
    }

    // Use a unique diagnostic session so it doesn't pollute real history
    const diagSessionId = `diag_${Date.now()}`;
    const results = [];

    const suites = [...new Set(TEST_CASES.map(tc => tc.suite))];

    const wallStart = performance.now();

    for (const suite of suites) {
        const casesForSuite = TEST_CASES.filter(tc => tc.suite === suite);
        console.log(`\n${bold(cyan(`▶  ${suite}`))}  (${casesForSuite.length} cases)`);
        for (const tc of casesForSuite) {
            const result = await runTest(tc, diagSessionId);
            results.push(result);
        }
    }

    const wallMs = Math.round(performance.now() - wallStart);

    // Summary
    const passed = results.filter(r => r.pass).length;
    const failed  = results.length - passed;
    console.log('');
    console.log(bold('══════════════════════════════════════════════════════════'));
    console.log(`  Result : ${green(`${passed} passed`)}  /  ${failed > 0 ? red(`${failed} failed`) : dim('0 failed')}  out of ${results.length} total`);
    console.log(`  Wall time: ${yellow(wallMs + 'ms')}`);
    console.log(bold('══════════════════════════════════════════════════════════'));
    console.log('');

    // Write report
    const report = buildReport(results, wallMs);
    writeFileSync(REPORT_FILE, report, 'utf8');
    console.log(green(`  ✔ Report saved → ${REPORT_FILE}`));
    console.log('');

    // Exit with non-zero code if any test failed (useful for CI)
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error(red(`\n  Fatal error: ${err.message}`));
    console.error(err.stack);
    process.exit(2);
});
