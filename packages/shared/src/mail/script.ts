// The Google Apps Script the user pastes once into script.google.com. It runs as them, in
// their own Google account, so JobBuddy never holds Gmail access. The keyword rules and the
// list of shared job hosts are embedded from classify.ts and companies.ts, so the script and
// the web app classify mail the same way (script.test.ts runs both on the same examples).

import { GOOD_NEWS, MAIL_ORDER, MAIL_RULES } from "./classify";
import { LEGAL_SUFFIX_SOURCE, SHARED_JOB_HOSTS } from "./companies";

export type MailScriptOptions = { appUrl: string; token: string };

// Plain ES5-style JavaScript (no backticks, no ${ }): it goes inside String.raw below.
const BODY = String.raw`
var LABELS = {
  good: "JobBuddy/Good news",
  rejected: "JobBuddy/Rejected",
  received: "JobBuddy/Received",
  checked: "JobBuddy/Checked"
};
var MAX_THREADS = 100;
var GENERIC_NAMES = ["remote", "jobs", "hiring", "careers", "talent", "team", "company", "confidential", "stealth", "stealth startup", "startup"];

/** Run this once: it adds the 15 minute timer and the labels, then checks your mail. */
function setup() {
  stop();
  ScriptApp.newTrigger("run").timeBased().everyMinutes(15).create();
  for (var k in LABELS) label_(LABELS[k]);
  run();
}

/** Run this to stop checking mail. Labels you already have stay. */
function stop() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "run") ScriptApp.deleteTrigger(t);
  });
}

/** Every 15 minutes. A dropped connection or a busy Gmail only means "try again next time":
 * labels go on after JobBuddy confirms, so nothing is missed. */
function run() {
  try {
    check_();
  } catch (e) {
    console.log("JobBuddy: this check didn't finish (" + e + "). Trying again in 15 minutes.");
  }
}

function check_() {
  var props = PropertiesService.getScriptProperties();
  var lastRun = Number(props.getProperty("lastRunAt")) || 0;
  var started = Date.now();
  var me = String(Session.getActiveUser().getEmail() || "").toLowerCase();

  var work = GmailApp.search("in:inbox newer_than:2d -label:jobbuddy-checked", 0, MAX_THREADS).map(function (t) {
    return { thread: t, after: 0 };
  });
  if (lastRun) {
    // New replies in threads checked before.
    GmailApp.search("in:inbox newer_than:1d label:jobbuddy-checked", 0, 50).forEach(function (t) {
      if (t.getLastMessageDate().getTime() > lastRun) work.push({ thread: t, after: lastRun - 60000 });
    });
  }
  if (work.length === 0) {
    props.setProperty("lastRunAt", String(started));
    return;
  }

  var companies = loadCompanies_();
  if (!companies) return;

  var items = [];
  var plans = work.map(function (w) {
    var plan = { thread: w.thread, kinds: {}, star: [] };
    w.thread.getMessages().forEach(function (m) {
      if (m.getDate().getTime() <= w.after) return;
      var from = String(m.getFrom() || "");
      if (me && from.toLowerCase().indexOf(me) >= 0) return;
      var subject = String(m.getSubject() || "");
      var body = String(m.getPlainBody() || "").slice(0, 4000);
      var kind = classifyMail(from, subject, body);
      if (kind === "other") return;
      plan.kinds[kind] = true;
      var match = matchApplication(companies, from, subject, body);
      if (GOOD_NEWS.indexOf(kind) >= 0) plan.star.push(m);
      if (kind === "received" && !match) return;
      items.push({
        applicationId: match ? match.applicationId : null,
        company: (match ? match.company : senderName_(from) || senderDomain_(from)).slice(0, 200),
        fromDomain: senderDomain_(from) || "unknown",
        subject: subject.slice(0, 300),
        snippet: body.replace(/\s+/g, " ").trim().slice(0, 300),
        receivedAt: m.getDate().toISOString(),
        classification: kind,
        gmailUrl: "https://mail.google.com/mail/#all/" + m.getId()
      });
    });
    return plan;
  });

  // Labels go on only after JobBuddy got the news, so nothing is lost when it is unreachable.
  for (var i = 0; i < items.length; i += 100) {
    if (!post_("/api/mail/report", { items: items.slice(i, i + 100) })) return;
  }
  plans.forEach(function (p) {
    if (GOOD_NEWS.some(function (g) { return p.kinds[g]; })) {
      p.thread.addLabel(label_(LABELS.good));
      p.star.forEach(function (m) { m.star(); });
    }
    if (p.kinds.rejection) p.thread.addLabel(label_(LABELS.rejected));
    if (p.kinds.received) p.thread.addLabel(label_(LABELS.received));
    p.thread.addLabel(label_(LABELS.checked));
  });
  props.setProperty("lastRunAt", String(started));
}

// ------------------------------------------------------------------ rules (same as JobBuddy)

var compiled_ = null;
function rules_() {
  if (!compiled_) {
    compiled_ = {};
    for (var k in RULES) {
      compiled_[k] = RULES[k].map(function (s) { return new RegExp(s, "i"); });
    }
  }
  return compiled_;
}

function any_(list, text) {
  for (var i = 0; i < list.length; i++) if (list[i].test(text)) return true;
  return false;
}

/** interview, assessment, offer, next_step, rejection, received or other. */
function classifyMail(from, subject, body) {
  var r = rules_();
  var head = from + "\n" + subject;
  var text = subject + "\n" + body;
  if (any_(r.job_alert, head)) return "other";
  if (!any_(r.hiring, from + "\n" + text)) return "other";
  for (var i = 0; i < ORDER.length; i++) {
    var c = ORDER[i];
    if (!any_(r[c], text)) continue;
    // A receipt that only mentions a later test or call stays a receipt.
    if (GOOD_NEWS.indexOf(c) >= 0 && any_(r.received, subject) && !any_(r.strong_subject, subject)) {
      return "received";
    }
    return c;
  }
  return "other";
}

// ------------------------------------------------------------------ which application

function words_(s) {
  return " " + String(s || "").toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim() + " ";
}

function companyName_(name) {
  return words_(name).replace(new RegExp(LEGAL_SUFFIX, "g"), " ").replace(/\s+/g, " ").trim();
}

function senderDomain_(from) {
  var m = /@([a-z0-9.-]+)/i.exec(from);
  return m ? m[1].toLowerCase().replace(/\.$/, "") : "";
}

function senderName_(from) {
  var i = from.indexOf("<");
  return (i > 0 ? from.slice(0, i) : "").replace(/["']/g, "").trim();
}

function isShared_(domain) {
  return SHARED_HOSTS.some(function (h) { return domain === h || domain.slice(-h.length - 1) === "." + h; }) ||
    /(^|\.)adzuna\./.test(domain);
}

function domainMatches_(domain, list) {
  var labels = domain.split(".").slice(0, -1);
  return list.some(function (d) {
    if (d.indexOf(".") >= 0) return domain === d || domain.slice(-d.length - 1) === "." + d;
    return labels.indexOf(d) >= 0;
  });
}

/** The application a mail is about: sender domain first, then sender name, subject, body. */
function matchApplication(companies, from, subject, body) {
  var domain = senderDomain_(from);
  var shared = !domain || isShared_(domain);
  var name = words_(senderName_(from));
  var subj = words_(subject);
  var text = words_(String(body || "").slice(0, 4000));
  var best = null;
  var bestScore = 0;
  var bestLen = 0;
  for (var i = 0; i < companies.length; i++) {
    var c = companies[i];
    var n = companyName_(c.company);
    var score = 0;
    if (!shared && domainMatches_(domain, c.domains || [])) score = 4;
    if (n.length >= 3 && GENERIC_NAMES.indexOf(n) < 0) {
      var needle = " " + n + " ";
      if (name.indexOf(needle) >= 0) score = Math.max(score, 3);
      else if (subj.indexOf(needle) >= 0) score = Math.max(score, 2);
      else if (text.indexOf(needle) >= 0) score = Math.max(score, 1);
    }
    if (score > bestScore || (score > 0 && score === bestScore && n.length > bestLen)) {
      best = c;
      bestScore = score;
      bestLen = n.length;
    }
  }
  return best ? { applicationId: best.applicationId, company: best.company } : null;
}

// ------------------------------------------------------------------ JobBuddy and Gmail

function loadCompanies_() {
  var res = UrlFetchApp.fetch(APP_URL + "/api/mail/companies", {
    headers: { Authorization: "Bearer " + MAIL_TOKEN },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code === 401) {
    console.log("JobBuddy: this mail key was turned off. Stopping. Create a new one in JobBuddy Settings.");
    stop();
    return null;
  }
  if (code !== 200) {
    console.log("JobBuddy is not reachable right now (" + code + "). Trying again in 15 minutes.");
    return null;
  }
  return JSON.parse(res.getContentText()).companies || [];
}

function post_(path, payload) {
  var res = UrlFetchApp.fetch(APP_URL + path, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + MAIL_TOKEN },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() === 200) return true;
  console.log("JobBuddy did not take the report (" + res.getResponseCode() + "). Trying again in 15 minutes.");
  return false;
}

var labelCache_ = {};
function label_(name) {
  if (!labelCache_[name]) labelCache_[name] = GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
  return labelCache_[name];
}
`;

/** The full .gs text with the app address and the user's mail key filled in. */
export function buildMailScript({ appUrl, token }: MailScriptOptions): string {
  const j = (v: unknown) => JSON.stringify(v, null, 2);
  return [
    "// JobBuddy: employer replies from Gmail.",
    "// Runs as you, inside your own Google account. Every 15 minutes it reads new inbox mail from",
    "// the last 2 days and labels it: JobBuddy/Good news (and a star), JobBuddy/Rejected,",
    "// JobBuddy/Received, and JobBuddy/Checked on everything it looked at.",
    "// It sends JobBuddy only short facts about employer replies: sender domain, subject, the first",
    "// 300 characters, date and a Gmail link. Never whole mails. It never deletes, archives or sends mail.",
    '// Start: run "setup" once and allow access. Stop: run "stop", or turn it off in JobBuddy Settings.',
    "",
    `var APP_URL = ${j(appUrl.replace(/\/+$/, ""))};`,
    `var MAIL_TOKEN = ${j(token)};`,
    "",
    "// Keyword rules, copied from JobBuddy. Edit them there, not here.",
    `var RULES = ${j(MAIL_RULES)};`,
    `var ORDER = ${JSON.stringify(MAIL_ORDER)};`,
    `var GOOD_NEWS = ${JSON.stringify(GOOD_NEWS)};`,
    `var SHARED_HOSTS = ${JSON.stringify(SHARED_JOB_HOSTS)};`,
    `var LEGAL_SUFFIX = ${JSON.stringify(LEGAL_SUFFIX_SOURCE)};`,
    BODY,
  ].join("\n");
}
