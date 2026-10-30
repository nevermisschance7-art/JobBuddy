import { describe, expect, it } from "vitest";
import { classifyMail } from "./classify";
import { MAIL_EXAMPLES } from "./examples.fixture";
import { buildMailScript } from "./script";

type Msg = { id: string; from: string; subject: string; body: string; date: Date };

/** Loads the generated script with fake Google services and returns its functions. */
function load(opts: { threads?: Msg[][]; companies?: unknown[]; status?: number } = {}) {
  const labels: Record<string, string[]> = {};
  const starred: string[] = [];
  const posts: { url: string; body: unknown }[] = [];
  const triggers: string[] = [];
  const props: Record<string, string> = {};
  const threads = (opts.threads ?? []).map((msgs, i) => ({
    getMessages: () =>
      msgs.map((m) => ({
        getId: () => m.id,
        getFrom: () => m.from,
        getSubject: () => m.subject,
        getPlainBody: () => m.body,
        getDate: () => m.date,
        star: () => starred.push(m.id),
      })),
    getLastMessageDate: () => msgs[msgs.length - 1]!.date,
    addLabel: (l: { name: string }) => (labels[`t${i}`] ??= []).push(l.name),
  }));
  const fakes = {
    GmailApp: {
      search: (q: string) => (q.includes("-label:jobbuddy-checked") ? threads : []),
      getUserLabelByName: () => null,
      createLabel: (name: string) => ({ name }),
    },
    ScriptApp: {
      newTrigger: (fn: string) => ({
        timeBased: () => ({ everyMinutes: () => ({ create: () => triggers.push(fn) }) }),
      }),
      getProjectTriggers: () => [],
      deleteTrigger: () => {},
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props[k] ?? null,
        setProperty: (k: string, v: string) => (props[k] = v),
      }),
    },
    Session: { getActiveUser: () => ({ getEmail: () => "sam@gmail.com" }) },
    UrlFetchApp: {
      fetch: (url: string, o: { payload?: string }) => {
        if (o.payload) posts.push({ url, body: JSON.parse(o.payload) });
        return {
          getResponseCode: () => opts.status ?? 200,
          getContentText: () => JSON.stringify({ companies: opts.companies ?? [] }),
        };
      },
    },
  };
  const script = buildMailScript({ appUrl: "https://jobbuddy.example/", token: "jbm_secret" });
  const make = new Function(
    ...Object.keys(fakes),
    `${script}\nreturn { run: run, setup: setup, classifyMail: classifyMail, matchApplication: matchApplication };`,
  );
  const api = make(...Object.values(fakes)) as {
    run: () => void;
    setup: () => void;
    classifyMail: (from: string, subject: string, body: string) => string;
    matchApplication: (
      companies: unknown[],
      from: string,
      subject: string,
      body: string,
    ) => { applicationId: string; company: string } | null;
  };
  return { api, labels, starred, posts, triggers, props, script };
}

describe("Apps Script", () => {
  it("fills in the app address and key", () => {
    const { script } = load();
    expect(script).toContain('var APP_URL = "https://jobbuddy.example";');
    expect(script).toContain('var MAIL_TOKEN = "jbm_secret";');
    // eslint-disable-next-line no-control-regex
    expect(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(script)).toBe(false);
  });

  it("classifies every example exactly like the TypeScript rules", () => {
    const { api } = load();
    for (const ex of MAIL_EXAMPLES) {
      expect(api.classifyMail(ex.from, ex.subject, ex.body), ex.name).toBe(classifyMail(ex));
    }
  });

  const companies = [
    { applicationId: "a1", company: "Acme Labs, Inc.", domains: ["acmelabs.io", "acmelabs"] },
    { applicationId: "a2", company: "Globex", domains: ["globex"] },
    { applicationId: "a3", company: "Remote", domains: [] },
  ];

  it("matches by sender domain, sender name, subject or body", () => {
    const { api } = load();
    const m = (from: string, subject = "", body = "") =>
      api.matchApplication(companies, from, subject, body)?.applicationId ?? null;
    expect(m("Jane <jane@talent.acmelabs.io>")).toBe("a1");
    expect(m("Globex Talent <talent@globex.com>")).toBe("a2");
    expect(m("Acme Labs Hiring <no-reply@us.greenhouse-mail.io>")).toBe("a1");
    expect(m("<no-reply@ashbyhq.com>", "Your application to Globex")).toBe("a2");
    expect(m("<no-reply@lever.co>", "Thanks", "Thank you for applying to Acme Labs.")).toBe("a1");
    // ATS domains never count as the employer's, and generic names never match text.
    expect(m("<no-reply@greenhouse.io>", "Remote role", "A remote job")).toBeNull();
  });

  it("labels, stars and reports good news and rejections, never whole mails", () => {
    const date = new Date("2026-10-30T10:00:00Z");
    const long = "x".repeat(5000);
    const { api, labels, starred, posts, triggers, props } = load({
      companies,
      threads: [
        [
          {
            id: "m1",
            from: "Jane <jane@acmelabs.io>",
            subject: "Next steps",
            body: `We'd love to chat about the Backend role. Share your availability. ${long}`,
            date,
          },
        ],
        [
          {
            id: "m2",
            from: "Globex <jobs@globex.com>",
            subject: "Your application",
            body: "Unfortunately we will not be moving forward.",
            date,
          },
        ],
        [
          {
            id: "m3",
            from: "Globex <jobs@globex.com>",
            subject: "Application received",
            body: "Thank you for applying to Globex.",
            date,
          },
        ],
        [
          {
            id: "m4",
            from: "Unknown <no-reply@lever.co>",
            subject: "Thanks",
            body: "Thank you for applying.",
            date,
          },
        ],
        [
          {
            id: "m5",
            from: "Sam <sam@gmail.com>",
            subject: "Interview",
            body: "Your availability?",
            date,
          },
        ],
      ],
    });
    api.setup();
    expect(triggers).toEqual(["run"]);
    expect(labels).toEqual({
      t0: ["JobBuddy/Good news", "JobBuddy/Checked"],
      t1: ["JobBuddy/Rejected", "JobBuddy/Checked"],
      t2: ["JobBuddy/Received", "JobBuddy/Checked"],
      t3: ["JobBuddy/Received", "JobBuddy/Checked"],
      t4: ["JobBuddy/Checked"],
    });
    expect(starred).toEqual(["m1"]);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe("https://jobbuddy.example/api/mail/report");
    const items = (posts[0]!.body as { items: Record<string, unknown>[] }).items;
    // The receipt without a matching application is not sent.
    expect(items.map((i) => [i.applicationId, i.classification])).toEqual([
      ["a1", "interview"],
      ["a2", "rejection"],
      ["a2", "received"],
    ]);
    expect(items[0]).toMatchObject({
      company: "Acme Labs, Inc.",
      fromDomain: "acmelabs.io",
      subject: "Next steps",
      gmailUrl: "https://mail.google.com/mail/#all/m1",
      receivedAt: date.toISOString(),
    });
    expect((items[0]!.snippet as string).length).toBeLessThanOrEqual(300);
    expect(props.lastRunAt).toBeDefined();
  });

  it("labels nothing when JobBuddy can't be reached, so the next run tries again", () => {
    const date = new Date();
    const { api, labels, props } = load({
      companies,
      status: 500,
      threads: [
        [
          {
            id: "m1",
            from: "jane@acmelabs.io",
            subject: "x",
            body: "Your availability for the role?",
            date,
          },
        ],
      ],
    });
    api.run();
    expect(labels).toEqual({});
    expect(props.lastRunAt).toBeUndefined();
  });
});
