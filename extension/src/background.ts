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
  void syncEverySite();
});
chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create(POLL, { periodInMinutes: 15, delayInMinutes: 1 });
  void syncEverySite();
});

// "Work on every site" (popup switch, optional permission): the form filler loads on every
// page, so the next page of a form and its thank-you page are seen on any site. It stays
// idle on pages where nothing was filled.
const EVERY_SITE = "every-site";
const ALL_URLS = { origins: ["<all_urls>"] };

async function syncEverySite(): Promise<void> {
  const granted = await chrome.permissions.contains(ALL_URLS);
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [EVERY_SITE] });
  if (granted && registered.length === 0) {
    await chrome.scripting.registerContentScripts([
      {
        id: EVERY_SITE,
        matches: ["<all_urls>"],
        js: ["content.js"],
        allFrames: true,
        runAt: "document_idle",
        persistAcrossSessions: true,
      },
    ]);
  } else if (!granted && registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [EVERY_SITE] });
  }
}
chrome.permissions.onAdded.addListener(() => void syncEverySite());

// Alt+A: load the filler into this tab (the shortcut grants access to it) and fill.
chrome.commands.onCommand.addListener((command) => {
  if (command !== "fill-application") return;
  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url ?? "")) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["content.js"],
      });
      await chrome.tabs.sendMessage(tab.id, { type: "fill-now" });
    } catch {
      // A page the extension can't work on (Chrome's own pages, the web store).
    }
  })();
});
chrome.permissions.onRemoved.addListener(() => void syncEverySite());
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

// ---------------------------------------------------------------- upload buttons

/**
 * Some forms (Hibob) make their file input only when "Add file" is clicked, and then open
 * the file window. Inside the page itself, this clicks the button and hands the file to the
 * input the page creates, instead of opening the window. Never submits anything.
 */
async function uploadThroughButton(
  message: Extract<Message, { type: "upload-button" }>,
  sender: chrome.runtime.MessageSender,
): Promise<boolean> {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return false;
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [sender.frameId ?? 0] },
    world: "MAIN",
    args: [message.marker, message.file.fileName, message.file.base64],
    func: (marker: string, fileName: string, base64: string) =>
      new Promise<boolean>((resolve) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const file = new File([bytes], fileName, { type: "application/pdf" });
        const proto = HTMLInputElement.prototype;
        const click = proto.click;
        // Older browsers have no showPicker.
        const picker = proto.showPicker as (() => void) | undefined;
        let given = false;
        const give = function (this: HTMLInputElement) {
          if (this.type !== "file" || given) return click.call(this);
          given = true;
          const dt = new DataTransfer();
          dt.items.add(file);
          this.files = dt.files;
          this.dispatchEvent(new Event("input", { bubbles: true }));
          this.dispatchEvent(new Event("change", { bubbles: true }));
        };
        proto.click = give;
        if (picker) proto.showPicker = give;
        const restore = () => {
          proto.click = click;
          if (picker) proto.showPicker = picker;
        };
        const button = document.querySelector<HTMLElement>(`[data-jobbuddy-upload="${marker}"]`);
        if (!button) {
          restore();
          return resolve(false);
        }
        button.click();
        setTimeout(() => {
          restore();
          resolve(given);
        }, 1500);
      }),
  });
  return Boolean(result?.result);
}

// ---------------------------------------------------------------- content script requests

async function handle(message: Message): Promise<unknown> {
  switch (message.type) {
    case "lookup":
      return api("lookup", {
        method: "POST",
        body: {
          url: message.url,
          applicationId: message.applicationId,
          title: message.title,
          text: message.text,
        },
      });
    case "prepare":
      return api("prepare", { method: "POST", body: message.input });
    case "applied":
      return api("applied", { method: "POST", body: { applicationId: message.applicationId } });
    case "cv":
      return api("cv", { method: "POST", body: { applicationId: message.applicationId } });
    case "learn":
      return api("learn", {
        method: "POST",
        body: { items: message.items, company: message.company },
      });
    case "dismiss":
      return api("dismiss", {
        method: "POST",
        body: { url: message.url, applicationId: message.applicationId, undo: message.undo },
      });
    case "open":
      // Only ever opens pages of the JobBuddy app.
      if (message.url.startsWith(`${APP_URL}/`)) await chrome.tabs.create({ url: message.url });
      return null;
  }
}

chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse: (r: Reply<unknown>) => void) => {
    (message.type === "upload-button" ? uploadThroughButton(message, sender) : handle(message))
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
