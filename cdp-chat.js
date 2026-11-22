/* =====================================================================
 * cdp-chat.js - 学习通AI实践·情景对话助手 (分享版)
 * ---------------------------------------------------------------------
 * 原理: 连接本机调试版 Edge 的 CDP 端口(9222), 自动完成「读对话/发消息/
 *       等回复/结束评估/查成绩」; 你当大脑(或 --auto 模式接 LLM)。
 *
 * 用法:
 *   node cdp-chat.js --once     只读模式: 打印情景/登录态/最新对话后退出
 *   node cdp-chat.js --launch   9222 未运行时自动启动调试 Edge
 *   node cdp-chat.js            交互模式(默认): 终端输入即发送
 *   node cdp-chat.js --auto     全自动模式(先运行「配置AI接口.bat」或设 CHAT_LLM_KEY)
 *
 * 作业链接配置(三选一, 全部可选):
 *   1) 运行本目录「设置作业链接.bat」(推荐, 存入 chat-url.txt)
 *   2) 环境变量 CHAT_URL
 *   3) 不配置: 启动的 Edge 里手动打开作业页也行
 *
 * 交互命令: /r /task /score /eval /restart /url /help /quit
 * 依赖: Node.js 21+ (内置 WebSocket 与 fetch), 零安装包依赖。
 * =================================================================== */
'use strict';
var http = require('http');
var path = require('path');
var os = require('os');
var fs = require('fs');
var cp = require('child_process');
var readline = require('readline');

var PORT = 9222;
var EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function c(s) { process.stdout.write(s + '\n'); }

/* ---------- 作业链接配置 ---------- */
function readConfigUrl() {
  try { return fs.readFileSync(path.join(__dirname, 'chat-url.txt'), 'utf8').trim(); } catch (e) { return ''; }
}
function getConfigUrl() {
  var env = String(process.env.CHAT_URL || '').trim();
  if (env) return env;
  return readConfigUrl();
}

/* ---------- CDP 基础 ---------- */
function httpGet(p) {
  return new Promise(function (res, rej) {
    var req = http.get({ host: '127.0.0.1', port: PORT, path: p }, function (r) {
      var d = '';
      r.on('data', function (x) { d += x; });
      r.on('end', function () { res(d); });
    });
    req.on('error', function (e) { rej(e); });
    req.setTimeout(2000, function () { req.destroy(); rej(new Error('timeout')); });
  });
}
async function cdpUp() {
  try { var v = await httpGet('/json/version'); return String(v).indexOf('ERR') !== 0; }
  catch (e) { return false; }
}
function profileDir() { return path.join(os.tmpdir(), 'edge-cdp'); }
function launchEdge(url) {
  var edge = EDGE_CANDIDATES.filter(function (p) { return fs.existsSync(p); })[0];
  if (!edge) throw new Error('未找到 msedge.exe, 请先安装 Microsoft Edge');
  var args = [
    '--remote-debugging-port=' + PORT,
    '--remote-allow-origins=*',
    '--user-data-dir=' + profileDir(),
    '--no-first-run', '--no-default-browser-check', '--noerrdialogs'
  ];
  if (url) args.push(url);
  cp.spawn(edge, args, { detached: true, stdio: 'ignore' }).unref();
}

function CDP(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); }
CDP.prototype.connect = function () {
  var self = this;
  return new Promise(function (ok, bad) {
    self.ws = new WebSocket(self.wsUrl);
    self.ws.onopen = ok;
    self.ws.onerror = function () { bad(new Error('WebSocket 连接失败')); };
    setTimeout(function () { bad(new Error('WebSocket 连接超时')); }, 8000);
    self.ws.onmessage = function (e) {
      var m = JSON.parse(e.data);
      if (m.id && self.pending.has(m.id)) { self.pending.get(m.id)(m); self.pending.delete(m.id); }
    };
  });
};
CDP.prototype.call = function (method, params) {
  var self = this;
  return new Promise(function (res) {
    var i = ++self.id;
    self.pending.set(i, res);
    self.ws.send(JSON.stringify({ id: i, method: method, params: params || {} }));
  });
};
CDP.prototype.eval = async function (expr) {
  var r = await this.call('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result && r.result.result ? r.result.result.value : undefined;
};
CDP.prototype.close = function () { try { this.ws.close(); } catch (e) { } };

async function getPage() {
  var list = JSON.parse(await httpGet('/json/list'));
  return list.find(function (t) { return t.type === 'page' && t.url.indexOf('situationalDialogue') >= 0; })
    || list.find(function (t) { return t.type === 'page' && t.url.indexOf('chaoxing') >= 0; })
    || list.find(function (t) { return t.type === 'page'; });
}

/* ---------- 页面读写 ---------- */
var TRANSCRIPT_JS = [
  'JSON.stringify(Array.prototype.slice.call(document.querySelectorAll(".message-row")).map(function(r){',
  'var b=r.querySelector(".message-bubble");var a=r.querySelector(".answer_content");',
  'var t=(b&&b.innerText&&b.innerText.trim())?b.innerText:(a&&a.innerText&&a.innerText.trim())?a.innerText:"";',
  'var me=r.className.indexOf("--user")>=0;',
  'return (me?"ME":"AI")+String.fromCharCode(31)+String(t).replace(/\\s+/g," ").slice(0,3000);}))'
].join('');
async function readTranscript(cdp) {
  var raw = await cdp.eval(TRANSCRIPT_JS) || '[]';
  return JSON.parse(raw).map(function (s) {
    var i = s.indexOf(String.fromCharCode(31));
    return { role: s.slice(0, i), text: s.slice(i + 1) };
  });
}
async function readInfo(cdp) {
  var body = String(await cdp.eval('(document.body?document.body.innerText:"").replace(/\\s+/g," ")') || '');
  var cookie = String(await cdp.eval('document.cookie') || '');
  var attempts = (body.match(/可作答次数\s*(\d+)/) || [])[1] || '?';
  var scoreM = body.match(/本次成绩\s*(\d+)/);
  var kind = '未知情景';
  if (/AI职业测评/.test(body)) kind = '职业测评';
  else if (/伦理思辨/.test(body)) kind = '伦理思辨';
  else if (/劳动模范|杨善林|袁隆平|顾秋亮/.test(body)) kind = '劳动人物';
  else if (/思辩|辩论/.test(body)) kind = '辩论擂台';
  return { kind: kind, attempts: attempts, score: scoreM ? Number(scoreM[1]) : null, login: /UID=/.test(cookie), head: body.slice(0, 300) };
}
async function readTask(cdp) {
  return String(await cdp.eval('(document.body?document.body.innerText:"").slice(0,1500)') || '');
}
async function sendText(cdp, text) {
  await cdp.eval('document.querySelector("textarea").focus()');
  await cdp.call('Input.insertText', { text: text });
  await sleep(400);
  await cdp.eval('Array.prototype.slice.call(document.querySelectorAll("button")).find(function(b){return (b.innerText||"").trim()==="发送";}).click()');
  await sleep(800);
}
function clickText(cdp, text) {
  var js = '(function(){var els=Array.prototype.slice.call(document.querySelectorAll("div,span,button,a")).filter(function(e){return (e.innerText||"").trim()==="' + text + '";});if(els.length){els[els.length-1].click();return true;}return false;})()';
  return cdp.eval(js);
}
async function confirmDialogs(cdp) {
  for (var i = 0; i < 3; i++) {
    var n = Number(await cdp.eval('(function(){var els=Array.prototype.slice.call(document.querySelectorAll("button,div")).filter(function(e){var t=(e.innerText||"").trim();return (t==="确定"||t==="确认")&&e.offsetParent!==null;});return els.length;})()') || 0);
    if (!n) break;
    await cdp.eval('(function(){var els=Array.prototype.slice.call(document.querySelectorAll("button,div")).filter(function(e){var t=(e.innerText||"").trim();return (t==="确定"||t==="确认")&&e.offsetParent!==null;});els[els.length-1].click();})()');
    await sleep(4000);
  }
}
async function waitForReply(cdp, beforeLast, timeoutMs) {
  var deadline = Date.now() + (timeoutMs || 240000);
  var prev = '', stable = 0;
  while (Date.now() < deadline) {
    await sleep(5000);
    var msgs = await readTranscript(cdp);
    var ai = msgs.filter(function (m) { return m.role === 'AI'; });
    var last = ai.length ? ai[ai.length - 1].text : '';
    if (last.length > 5 && last !== beforeLast) {
      if (last === prev) { stable++; } else { prev = last; stable = 0; }
      if (stable >= 2) return msgs;
    }
  }
  return await readTranscript(cdp);
}
async function endAndEval(cdp) {
  await clickText(cdp, '结束练习并评估');
  await sleep(6000);
  await confirmDialogs(cdp);
  var score = null, body = '';
  for (var i = 0; i < 40; i++) {
    body = String(await cdp.eval('(document.body?document.body.innerText:"").replace(/\\s+/g," ")') || '');
    var m = body.match(/本次成绩\s*(\d+)/);
    if (m) { score = Number(m[1]); if (score > 0) break; }
    await sleep(6000);
  }
  var full = String(await cdp.eval('(document.body?document.body.innerText:"")') || '');
  var idx = full.indexOf('本次评估结果');
  return { score: score, report: idx >= 0 ? full.slice(idx, idx + 3000) : '' };
}

/* ---------- 自动模式 ---------- */
function buildSystemPrompt(kind, task) {
  return [
    '你在一款网页AI情景对话里扮演主角「大一新生小林」(刚军训结束, 真诚、有条理、略带自嘲的幽默)。',
    '当前情景类型: ' + kind + '。任务说明(供参考, 不要逐字复述):',
    String(task).replace(/\s+/g, ' ').slice(0, 600),
    '要求: 1)只输出小林的下一条中文回复正文, 不要解释、标题或markdown; 2)长度100~300字, 口语自然;',
    '3)紧扣对方最新一条发言, 回应其问题后再自然推进; 4)展现学习能力、沟通共情、自我觉察与具体可执行的行动;',
    '5)提出方案时给出具体可操作的细节(人/事/时间), 不说空话。'
  ].join('\n');
}
async function callLLM(api, key, model, sys, history) {
  var res = await fetch(api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model: model, temperature: 0.7, messages: [{ role: 'system', content: sys }].concat(history) })
  });
  if (!res.ok) throw new Error('LLM接口返回 ' + res.status + ': ' + (await res.text()).slice(0, 200));
  var data = await res.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}
function readLlmConfig() {
  var out = {};
  try {
    var lines = fs.readFileSync(path.join(__dirname, 'llm-config.txt'), 'utf8').split(/\r?\n/);
    lines.forEach(function (ln) {
      var i = ln.indexOf('=');
      if (i > 0) out[String(ln.slice(0, i)).trim()] = String(ln.slice(i + 1)).trim();
    });
  } catch (e) { }
  return out;
}
async function autoLoop(cdp) {
  var cfg = readLlmConfig();
  var key = String(process.env.CHAT_LLM_KEY || cfg.key || '').trim();
  var api = String(process.env.CHAT_LLM_API || cfg.api || '').trim();
  var model = String(process.env.CHAT_LLM_MODEL || cfg.model || '').trim();
  var rounds = Number(process.env.CHAT_AUTO_ROUNDS || cfg.rounds || 5);
  if (!key || !api) {
    c('[x] 尚未配置 AI 接口(可选功能, 不配置就是手动模式, 不花钱)。两种方式任选:');
    c('    1) 双击本目录「配置AI接口.bat」, 按提示选服务商并粘贴 Key(推荐);');
    c('    2) 命令行环境变量: CHAT_LLM_KEY / CHAT_LLM_API / CHAT_LLM_MODEL。');
    c('    配置保存在 llm-config.txt, 已被 .gitignore 忽略, 不会提交; Key 属于你个人, 请勿外传。');
    process.exit(1);
  }
  var info = await readInfo(cdp);
  if (!info.login) c('[!] 尚未登录学习通, 请先在调试Edge窗口扫码登录!');
  var sys = buildSystemPrompt(info.kind, await readTask(cdp));
  c('[auto] 情景:' + info.kind + '  轮数:' + rounds + '  模型:' + model + '  Key:' + key.slice(0, 6) + '****');
  for (var r = 0; r < rounds; r++) {
    var ms = await readTranscript(cdp);
    var ai = ms.filter(function (m) { return m.role === 'AI'; });
    var before = ai.length ? ai[ai.length - 1].text : '';
    var history = ms.slice(-8).map(function (m) { return { role: m.role === 'ME' ? 'assistant' : 'user', content: m.text }; });
    c('\n[auto ' + (r + 1) + '/' + rounds + '] 生成回复...');
    var reply = '';
    try { reply = (await callLLM(api, key, model, sys, history)).trim(); }
    catch (e) { c('[x] LLM调用失败: ' + e.message); break; }
    if (!reply) { c('[x] 空回复, 停止'); break; }
    c('[小林] ' + reply.slice(0, 300));
    await sendText(cdp, reply);
    c('[OK] 已发送, 等待对方...');
    var msgs = await waitForReply(cdp, before, 240000);
    var ai2 = msgs.filter(function (m) { return m.role === 'AI'; });
    var last = ai2.length ? ai2[ai2.length - 1].text : '';
    c('[对方] ' + (last && last !== before ? last.slice(0, 600) : '(未见新回复)'));
  }
  if (process.env.CHAT_AUTO_EVAL === '1') {
    c('\n[*] 点击 结束练习并评估...');
    var res = await endAndEval(cdp);
    c('★ 本次成绩: ' + (res.score || '(评分中)'));
    if (res.report) c(res.report.slice(0, 1600));
  } else {
    c('\n[auto] 完成。之后可运行 node cdp-chat.js 输入 /eval 结束评分。');
  }
}

/* ---------- 交互模式 ---------- */
var HELP = [
  '命令: /r 重读对话  /task 任务说明  /score 查状态  /eval 结束并评分',
  '      /restart 重开练习  /url 查看配置的链接  /help 帮助  /quit 退出',
  '其余任何输入都会作为你的回复直接发送到页面。'
].join('\n');
async function interactive(cdp) {
  var info = await readInfo(cdp);
  c('\n================ 已连接调试 Edge ================');
  c('情景: ' + info.kind + '  |  可作答次数: ' + info.attempts + (info.score ? ('  |  页面显示成绩: ' + info.score) : ''));
  var cfg = getConfigUrl();
  c('作业链接: ' + (cfg ? '已配置(' + cfg.slice(0, 60) + '...)' : '未配置(不影响使用, 手动在浏览器打开作业页即可)'));
  if (!info.login) c('[!] 未检测到登录态(UID cookie) —— 请先在调试Edge窗口里登录学习通!');
  c('任务说明(前300字):');
  c(String(await readTask(cdp)).replace(/\s+/g, ' ').slice(0, 300));
  c('==================================================');
  c(HELP + '\n');
  var show = async function () {
    var ms = await readTranscript(cdp);
    c('\n--- 对话(共' + ms.length + '条, 显示末6条) ---');
    ms.slice(-6).forEach(function (m) { c((m.role === 'ME' ? '[我] ' : '[对方] ') + m.text.slice(0, 500)); });
  };
  await show();
  var rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '\n回复> ' });
  rl.prompt();
  rl.on('line', async function (line) {
    var s = line.trim();
    try {
      if (!s) { }
      else if (s === '/r') { await show(); }
      else if (s === '/task') { c(await readTask(cdp)); }
      else if (s === '/help') { c(HELP); }
      else if (s === '/url') { var u = getConfigUrl(); c(u ? u : '(未配置。运行「设置作业链接.bat」可配置)'); }
      else if (s === '/score') { var i2 = await readInfo(cdp); c('情景:' + i2.kind + ' | 成绩:' + (i2.score || '无') + ' | 次数:' + i2.attempts + ' | 登录:' + (i2.login ? '是' : '否')); }
      else if (s === '/eval') {
        c('[*] 点击 结束练习并评估...');
        var r = await endAndEval(cdp);
        c('★ 本次成绩: ' + (r.score ? r.score : '(评分中, 稍后 /score 查看)'));
        if (r.report) c('\n--- 评估报告 ---\n' + r.report.slice(0, 1600));
      }
      else if (s === '/restart') {
        c('[*] 重开练习...');
        await clickText(cdp, '重新练习');
        await sleep(5000);
        await confirmDialogs(cdp);
        await show();
      }
      else if (s === '/quit') { c('再见!'); process.exit(0); }
      else {
        var ms = await readTranscript(cdp);
        var ai = ms.filter(function (m) { return m.role === 'AI'; });
        var before = ai.length ? ai[ai.length - 1].text : '';
        await sendText(cdp, s);
        c('[OK] 已发送, 等待对方回复...');
        var msgs = await waitForReply(cdp, before, 240000);
        var ai2 = msgs.filter(function (m) { return m.role === 'AI'; });
        var last = ai2.length ? ai2[ai2.length - 1].text : '';
        c('\n[对方] ' + (last && last !== before ? last.slice(0, 900) : '(等待超时或未见新回复, 可 /r 重读)'));
      }
    } catch (e) { c('[x] 出错: ' + e.message); }
    rl.prompt();
  });
  rl.on('close', function () { c('\n(输入流结束, 退出)'); process.exit(0); });
}

/* ---------- 只读模式 ---------- */
async function dumpOnce() {
  if (!await cdpUp()) { c('[x] 9222 未监听: 请先双击「启动对话助手.bat」。'); process.exit(1); }
  var page = await getPage();
  var cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.connect();
  var info = await readInfo(cdp);
  c('情景: ' + info.kind + ' | 次数: ' + info.attempts + ' | 登录: ' + (info.login ? '是' : '否'));
  c('--- 任务说明(前600字) ---');
  c(String(await readTask(cdp)).replace(/\s+/g, ' ').slice(0, 600));
  var msgs = await readTranscript(cdp);
  c('--- 对话 共' + msgs.length + '条 ---');
  msgs.slice(-4).forEach(function (m) { c((m.role === 'ME' ? '[我] ' : '[对方] ') + m.text.slice(0, 250)); });
  cdp.close();
}

/* ---------- main ---------- */
async function main() {
  if (typeof WebSocket !== 'function') { c('[x] 需要 Node.js 21+ (内置WebSocket), 当前: ' + process.version); process.exit(1); }
  var argv = process.argv.slice(2);
  if (argv.indexOf('--once') >= 0) { await dumpOnce(); return; }
  var cfg = getConfigUrl();
  if (!await cdpUp()) {
    if (argv.indexOf('--launch') >= 0) {
      c('[*] 调试 Edge 未运行, 尝试启动...' + (cfg ? '(将打开你配置的作业页)' : '(请在弹出的窗口里打开你的作业页)'));
      launchEdge(cfg);
      for (var i = 0; i < 20; i++) { await sleep(2000); if (await cdpUp()) break; }
    }
  }
  if (!await cdpUp()) { c('[x] 未检测到调试Edge(端口' + PORT + ')。请双击「启动对话助手.bat」重试。'); process.exit(1); }
  var page = await getPage();
  if (!page) { c('[x] 没有可控制的页面。'); process.exit(1); }
  var cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.call('Page.enable');
  if (String(page.url).indexOf('chaoxing') < 0) {
    c('[!] 当前页面还不是学习通页。请在调试Edge里登录学习通并打开「AI实践」情景对话页, 然后回到这里输入 /r');
    c('    (如果嫌每次手动开麻烦, 可运行「设置作业链接.bat」配置自动打开)');
  }
  if (argv.indexOf('--auto') >= 0) { await autoLoop(cdp); }
  else { await interactive(cdp); }
}

module.exports = {
  PORT: PORT, getConfigUrl: getConfigUrl, cdpUp: cdpUp, getPage: getPage, CDP: CDP,
  readTranscript: readTranscript, readInfo: readInfo, readTask: readTask,
  sendText: sendText, clickText: clickText, confirmDialogs: confirmDialogs,
  waitForReply: waitForReply, endAndEval: endAndEval, launchEdge: launchEdge,
  buildSystemPrompt: buildSystemPrompt, callLLM: callLLM, readLlmConfig: readLlmConfig
};

if (require.main === module) {
  main().catch(function (e) { c('[x] ' + (e && e.message || e)); process.exit(1); });
}
