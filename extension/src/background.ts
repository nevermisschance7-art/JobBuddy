import {
  alertMessage,
  alertsToShow,
  inQuietHours,
  type AlertEvent,
  type AlertSettings,
  type Tone,
} from "@jobbuddy/shared";
import { api, APP_URL, getSession, SignedOutError } from "./api";
import type { Message, Reply } from "./types";

// Background service worker: polls alerts every 15 minutes, keeps the badge count, and makes
// web app requests for content scripts. Rule: this extension never clicks Submit.

type Summary = {
  tone: Tone;
  timeZone: string;
  alertSettings: AlertSettings;
  newMatches: number;
  toReview: number;
};

const POLL = "poll-alerts";
const MAX_PER_POLL = 3;

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create(POLL, { periodInMinutes: 15, delayInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create(POLL, { periodInMinutes: 15, delayInMinutes: 1 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL) void poll();
});

async function poll(): Promise<void> {
  if (!(await getSession())) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  try {
    const { lastPoll } = await chrome.storage.local.get("lastPoll");
    const since =
      typeof lastPoll === "string" ? lastPoll : new Date(Date.now() - 3_600_000).toISOString();
    const [summary, { events, unread }] = await Promise.all([
      api<Summary>("summary"),
      api<{ events: AlertEvent[]; unread: number }>(`events?since=${encodeURIComponent(since)}`),
    ]);
    await chrome.action.setBadgeBackgroundColor({ color: "#4f46e5" });
    await chrome.action.setBadgeText({ text: unread > 0 ? String(Math.min(unread, 99)) : "" });

    // During quiet hours nothing is shown and `since` stays put, so alerts wait until morning.
    if (inQuietHours(new Date(), summary.timeZone, summary.alertSettings)) return;
    const show = alertsToShow(events, summary.alertSettings, summary.timeZone);
    for (const e of show.slice(-MAX_PER_POLL)) {
      const { title, message } = alertMessage(e, summary.tone);
      chrome.notifications.create(`event:${e.id}`, {
        type: "basic",
        iconUrl: "icon-128.png",
        title,
        message,
        priority: 1,
      });
    }
    // Next time, only events after the newest one seen (never a clock time, so none are skipped).
    const newest = events.at(-1)?.created_at;
    if (newest) await chrome.storage.local.set({ lastPoll: newest });
  } catch (e) {
    if (e instanceof SignedOutError) await chrome.action.setBadgeText({ text: "" });
    else console.warn("JobBuddy poll failed", e);
  }
}

chrome.notifications.onClicked.addListener((id) => {
  const eventId = id.startsWith("event:") ? id.slice(6) : null;
  void chrome.tabs.create({ url: `${APP_URL}/app` });
  chrome.notifications.clear(id);
  if (eventId)
    void api("events", { method: "POST", body: { ids: [eventId] } })
      .then(poll)
      .catch(() => {});
});

// ---------------------------------------------------------------- content script requests

async function handle(message: Message): Promise<unknown> {
  switch (message.type) {
    case "lookup":
      return api("lookup", {
        method: "POST",
        body: { url: message.url, applicationId: message.applicationId },
      });
    case "prepare":
      return api("prepare", { method: "POST", body: message.input });
    case "applied":
      return api("applied", { method: "POST", body: { applicationId: message.applicationId } });
    case "cv":
      return api("cv", { method: "POST", body: { applicationId: message.applicationId } });
    case "learn":
      return api("learn", { method: "POST", body: { items: message.items } });
    case "open":
      // Only ever opens pages of the JobBuddy app.
      if (message.url.startsWith(`${APP_URL}/`)) await chrome.tabs.create({ url: message.url });
      return null;
  }
}

chrome.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse: (r: Reply<unknown>) => void) => {
    handle(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e: unknown) =>
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : "Something went wrong.",
          signedOut: e instanceof SignedOutError,
        }),
      );
    return true; // keeps the channel open for the async reply
  },
);

// Popup asks for a fresh poll after signing in.
chrome.storage.onChanged.addListener((changes) => {
  if (changes.session?.newValue && !changes.session.oldValue) void poll();
});
