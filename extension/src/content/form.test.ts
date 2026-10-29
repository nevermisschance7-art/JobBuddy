// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { FillData } from "../types";
import {
  classify,
  collectFields,
  currentAnswer,
  fillComboboxes,
  fillForm,
  formQuestions,
  isConfirmation,
  noticeToDate,
  pickOption,
} from "./form";

// Shapes modelled on the real forms: Greenhouse (label + input in div.field), Lever
// (.application-question with .application-label), Ashby (React, label for=id).

const greenhouse = `
<form id="application_form">
  <div class="field"><label for="first_name">First Name *</label><input id="first_name" name="job_application[first_name]" required></div>
  <div class="field"><label for="last_name">Last Name *</label><input id="last_name" name="job_application[last_name]" required></div>
  <div class="field"><label for="email">Email *</label><input id="email" type="text" name="job_application[email]" required></div>
  <div class="field"><label for="phone">Phone</label><input id="phone" type="text" name="job_application[phone]"></div>
  <div class="field"><label>Resume/CV *</label><input type="file" id="resume" name="resume" style="display:none"></div>
  <div class="field"><label for="q1">LinkedIn Profile</label><input id="q1" name="job_application[answers_attributes][0][text_value]"></div>
  <div class="field"><label for="q2">Why do you want to work at Acme? *</label><textarea id="q2" name="job_application[answers_attributes][1][text_value]"></textarea></div>
  <div class="field"><label for="q3">Will you now or in the future require visa sponsorship? *</label>
    <select id="q3" name="job_application[answers_attributes][2][boolean_value]"><option value="">Please select</option><option value="1">Yes</option><option value="0">No</option></select></div>
  <div class="field"><label for="q4">What are your salary expectations?</label><input id="q4" name="job_application[answers_attributes][3][text_value]"></div>
  <div class="field"><label for="q5">Anything else we should know?</label><textarea id="q5"></textarea></div>
  <input type="submit" value="Submit Application">
</form>`;

const lever = `
<form>
  <ul>
    <li class="application-question"><div class="application-label">Full name<span class="required">*</span></div>
      <div class="application-field"><input type="text" name="name" required></div></li>
    <li class="application-question"><div class="application-label">Email</div><div class="application-field"><input type="email" name="email"></div></li>
    <li class="application-question"><div class="application-label">GitHub URL</div><div class="application-field"><input type="text" name="urls[GitHub]"></div></li>
    <li class="application-question"><div class="application-label">Are you legally authorized to work in the country you are applying for?</div>
      <div class="application-field"><ul>
        <li><label><input type="radio" name="cards[abc][field0]" value="Yes">Yes</label></li>
        <li><label><input type="radio" name="cards[abc][field0]" value="No">No</label></li>
      </ul></div></li>
  </ul>
  <button type="submit">Submit application</button>
</form>`;

const data: FillData = {
  applicationId: "app-1",
  status: "prepared",
  profile: {
    fullName: "Sam Tester",
    firstName: "Sam",
    lastName: "Tester",
    email: "sam@example.com",
    phone: "+44 7700 900123",
    city: "Manchester",
    countryCode: "GB",
    linkedin: "https://linkedin.com/in/sam",
    github: "https://github.com/sam",
    website: null,
    country: "United Kingdom",
    currentCompany: "Brightbank",
    currentTitle: "Backend Engineer",
    headline: "Backend Engineer",
    summary: "Backend engineer with 6 years of Python.",
  },
  fixedAnswers: { needs_sponsorship: "No", right_to_work: "Yes" },
  answers: [
    {
      question: "Why do you want to work at Acme?",
      answer: "I like the product.",
      isCoverLetter: false,
    },
  ],
  cv: null,
};

const value = (sel: string) => (document.querySelector(sel) as HTMLInputElement).value;

describe("Greenhouse-style form", () => {
  beforeEach(() => {
    document.body.innerHTML = greenhouse;
  });

  it("reads labels and kinds", () => {
    const fields = collectFields(document);
    expect(fields.map((f) => [f.label, f.kind])).toEqual([
      ["First Name", "first_name"],
      ["Last Name", "last_name"],
      ["Email", "email"],
      ["Phone", "phone"],
      ["Resume/CV", "resume"],
      ["LinkedIn Profile", "linkedin"],
      ["Why do you want to work at Acme?", "question"],
      ["Will you now or in the future require visa sponsorship?", "question"],
      ["What are your salary expectations?", "question"],
      ["Anything else we should know?", "question"],
    ]);
    expect(fields[0]!.required).toBe(true);
  });

  it("fills contact details, fixed answers and drafted answers, and reports the rest", () => {
    const report = fillForm(collectFields(document), data);
    expect(value("#first_name")).toBe("Sam");
    expect(value("#email")).toBe("sam@example.com");
    expect(value("#q1")).toBe("https://linkedin.com/in/sam");
    expect(value("#q2")).toBe("I like the product.");
    expect(value("#q3")).toBe("0"); // "No" from the fixed answer, never the AI
    expect(report.resume?.kind).toBe("resume");
    // No fixed salary answer: left empty for the user, never guessed.
    expect(value("#q4")).toBe("");
    expect(report.missed.map((f) => f.label)).toEqual([
      "What are your salary expectations?",
      "Anything else we should know?",
    ]);
  });

  it("leaves fields the user already filled", () => {
    (document.querySelector("#email") as HTMLInputElement).value = "own@example.com";
    fillForm(collectFields(document), data);
    expect(value("#email")).toBe("own@example.com");
  });

  it("fires input events so React forms notice", () => {
    let events = 0;
    document.querySelector("#first_name")!.addEventListener("input", () => events++);
    fillForm(collectFields(document), data);
    expect(events).toBe(1);
  });

  it("lists the form's questions for drafting", () => {
    expect(formQuestions(collectFields(document))).toContain("Why do you want to work at Acme?");
  });
});

describe("Lever-style form", () => {
  beforeEach(() => {
    document.body.innerHTML = lever;
  });

  it("reads container labels and radio groups", () => {
    const fields = collectFields(document);
    expect(fields.map((f) => f.kind)).toEqual(["full_name", "email", "github", "question"]);
    expect(fields[3]!.label).toBe(
      "Are you legally authorized to work in the country you are applying for?",
    );
    expect(fields[3]!.options?.map((o) => o.label)).toEqual(["Yes", "No"]);
  });

  it("checks the radio matching the fixed answer", () => {
    fillForm(collectFields(document), data);
    expect(value("input[name=name]")).toBe("Sam Tester");
    expect((document.querySelector("input[value=Yes]") as HTMLInputElement).checked).toBe(true);
  });
});

describe("helpers", () => {
  it("classifies by attributes", () => {
    expect(classify({ label: "", autocomplete: "given-name" })).toBe("first_name");
    expect(classify({ label: "Cover letter", type: "file" })).toBe("cover_letter");
    expect(classify({ label: "Why do you use LinkedIn so much in your work?" })).toBe("question");
  });

  it("picks options by meaning", () => {
    const opts = [
      { label: "Yes, I will need sponsorship" },
      { label: "No, I don't need sponsorship" },
    ];
    expect(pickOption(opts, "No")).toBe(opts[1]);
    expect(pickOption(opts, "Maybe")).toBeNull();
  });

  it("detects the confirmation page", () => {
    document.body.innerHTML = "<h1>Thank you for applying!</h1><p>We'll be in touch.</p>";
    expect(isConfirmation(document, "https://jobs.lever.co/acme/123/thanks")).toBe(true);
    // Recruitee
    document.body.innerHTML =
      "<h2>All done!</h2><p>Your application has been successfully submitted!</p><a>Other jobs</a>";
    expect(
      isConfirmation(document, "https://acme.recruitee.com/o/azure-devops-engineer/c/new"),
    ).toBe(true);
    document.body.innerHTML = lever + "<p>Thanks for your interest in Acme</p>";
    expect(isConfirmation(document, "https://jobs.lever.co/acme/123/apply")).toBe(false);
  });
});

// Ashby: questions answered with buttons; react-select style dropdown (Greenhouse, Lever).
const ashby = `
<form>
  <div class="field"><label for="_systemfield_name">Name</label><input id="_systemfield_name"></div>
  <div class="field"><label for="_systemfield_email">Email</label><input id="_systemfield_email" type="email"></div>
  <div class="field">
    <label class="question-title">Do you have work authorization to work in that country?*</label>
    <div class="yesno"><button type="button">Yes</button><button type="button">No</button></div>
  </div>
  <div class="field">
    <label id="loc-label">Location</label>
    <div class="select__control"><input id="loc" role="combobox" aria-autocomplete="list" aria-labelledby="loc-label" aria-controls="loc-list"></div>
    <div id="loc-list" role="listbox"></div>
  </div>
  <button type="submit">Submit Application</button>
</form>`;

describe("Ashby-style buttons and dropdowns", () => {
  beforeEach(() => {
    document.body.innerHTML = ashby;
    // A dropdown that shows matching options once the user types, like react-select.
    const input = document.querySelector<HTMLInputElement>("#loc")!;
    const list = document.querySelector("#loc-list")!;
    input.addEventListener("input", () => {
      list.innerHTML = ["Warsaw, Masovian Voivodeship, Poland", "Warsaw, Indiana, United States"]
        .filter((o) => o.toLowerCase().includes(input.value.toLowerCase()))
        .map((o) => `<div role="option">${o}</div>`)
        .join("");
      list.querySelectorAll("[role=option]").forEach((o) =>
        o.addEventListener("click", () => {
          input.value = "";
          input.setAttribute("data-picked", o.textContent ?? "");
          list.innerHTML = "";
        }),
      );
    });
    // Clicking a choice button marks it selected, like Ashby does.
    document
      .querySelectorAll(".yesno button")
      .forEach((b) => b.addEventListener("click", () => b.setAttribute("aria-pressed", "true")));
  });

  it("finds the button question and the dropdown", () => {
    const fields = collectFields(document);
    const yesNo = fields.find((f) => f.choices);
    expect(yesNo?.label).toBe("Do you have work authorization to work in that country?");
    expect(yesNo?.choices?.map((c) => c.label)).toEqual(["Yes", "No"]);
    expect(yesNo?.required).toBe(true);
    expect(fields.find((f) => f.combobox)?.label).toBe("Location");
    // The submit button is never taken as a choice.
    expect(fields.some((f) => f.choices?.some((c) => /submit/i.test(c.label)))).toBe(false);
  });

  it("clicks Yes from the yes/no fixed answer and picks the dropdown option", async () => {
    const withLocation: FillData = {
      ...data,
      fixedAnswers: { work_authorized: "Yes", location: "Warsaw, Poland" },
    };
    const report = fillForm(collectFields(document), withLocation);
    expect(document.querySelector(".yesno button")!.getAttribute("aria-pressed")).toBe("true");
    expect(report.dropdowns).toHaveLength(1);
    await fillComboboxes(report.dropdowns, report);
    expect(document.querySelector("#loc")!.getAttribute("data-picked")).toBe(
      "Warsaw, Masovian Voivodeship, Poland",
    );
  });

  it("uses a right-to-work answer that starts with yes/no for yes/no buttons", () => {
    const report = fillForm(collectFields(document), {
      ...data,
      fixedAnswers: { right_to_work: "No, I need a visa for the US" },
    });
    expect(document.querySelectorAll(".yesno button")[1]!.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(report.missed.map((f) => f.label)).not.toContain(
      "Do you have work authorization to work in that country?",
    );
  });
});

describe("traps, languages and employers", () => {
  it("never fills a bot trap field", () => {
    document.body.innerHTML = `
      <label for="w">Enter website. This input is for robots only, do not enter if you're human.</label>
      <input id="w" name="website">
      <label for="e">Email</label><input id="e" type="email">`;
    const fields = collectFields(document);
    expect(fields.map((f) => f.kind)).toEqual(["email"]);
    fillForm(fields, data);
    expect((document.querySelector("#w") as HTMLInputElement).value).toBe("");
  });

  it("strips required marks in other languages", () => {
    document.body.innerHTML = `<label for="q">¿Cuáles son tus pretensiones económicas?*Obligatorio</label><input id="q">`;
    expect(collectFields(document)[0]!.label).toBe("¿Cuáles son tus pretensiones económicas?");
  });

  it("answers 'worked for us before?' from the CV's employers", () => {
    document.body.innerHTML = `
      <label for="s">Are you currently or have you previously worked for Philips?</label>
      <select id="s"><option value="">Select</option><option>Yes</option><option>No</option></select>`;
    const withEmployers = { ...data, profile: { ...data.profile, employers: ["Brightbank"] } };
    fillForm(collectFields(document), { ...withEmployers, jobCompany: "Philips" });
    expect((document.querySelector("#s") as HTMLSelectElement).value).toBe("No");
    fillForm(collectFields(document), { ...withEmployers, jobCompany: "Brightbank" });
  });
});

describe("Camunda / RevenueCat style questions and learning", () => {
  it("knows preferred name, legal name, address line and post code", () => {
    expect(classify({ label: "What is your preferred name?" })).toBe("first_name");
    expect(classify({ label: "What is your Legal first and last name?" })).toBe("full_name");
    expect(classify({ label: "What is the first line of your address?" })).toBe("address");
    expect(classify({ label: "Post Code" })).toBe("postal_code");
  });

  it("fills a field from what the user typed on an earlier form", () => {
    document.body.innerHTML = `<label for="a">What is the first line of your address?</label><input id="a">
      <label for="s">If you are eligible, please select the status that allows you to work</label>
      <select id="s"><option value="">Select</option><option>I am a citizen / permanent resident</option><option>I have a work visa</option></select>`;
    const learned = {
      ...data,
      learned: [
        { question: "What is the first line of your address?", answer: "1 Example Street" },
        {
          question:
            "If you are eligible, please select the status that allows you to work and live in that Country",
          answer: "I am a citizen / permanent resident",
        },
      ],
    };
    fillForm(collectFields(document), learned);
    expect((document.querySelector("#a") as HTMLInputElement).value).toBe("1 Example Street");
    expect((document.querySelector("#s") as HTMLSelectElement).selectedOptions[0]!.text).toBe(
      "I am a citizen / permanent resident",
    );
  });

  it("reads what the user typed, to learn it", () => {
    document.body.innerHTML = `<label for="p">Post Code</label><input id="p" value="NR1 1AA">`;
    expect(currentAnswer(collectFields(document)[0]!)).toBe("NR1 1AA");
  });

  it("picks from a dropdown list without option markers", async () => {
    document.body.innerHTML = `
      <label id="l">What location do you plan to work from?</label>
      <div class="select"><input id="c" role="combobox" aria-labelledby="l"></div>
      <ul class="dropdown-list"></ul>`;
    const input = document.querySelector<HTMLInputElement>("#c")!;
    const list = document.querySelector("ul")!;
    input.addEventListener("input", () => {
      list.innerHTML = ["United States", "United Kingdom", "United Arab Emirates"]
        .filter((o) => o.toLowerCase().includes(input.value.toLowerCase()))
        .map((o) => `<li>${o}</li>`)
        .join("");
      list
        .querySelectorAll("li")
        .forEach((li) =>
          li.addEventListener("click", () =>
            input.setAttribute("data-picked", li.textContent ?? ""),
          ),
        );
    });
    const report = fillForm(collectFields(document), {
      ...data,
      fixedAnswers: { location: "United Kingdom" },
    });
    await fillComboboxes(report.dropdowns, report);
    expect(input.getAttribute("data-picked")).toBe("United Kingdom");
  });
});

describe("BambooHR-style form", () => {
  const bamboo = `
    <div class="field"><div class="fab-FormField"><label class="fab-Label">Resume*</label>
      <label for="f" class="fab-Button">Choose File*</label><input type="file" id="f" style="display:none"></div></div>
    <div class="field"><label for="d">Date Available*</label><input type="date" id="d"></div>
    <div class="field"><label for="a">Anything you would like to add?*</label><textarea id="a"></textarea></div>`;

  it("finds required marks, the CV upload under its heading, and fills the date", () => {
    document.body.innerHTML = bamboo;
    const fields = collectFields(document);
    expect(fields.map((f) => [f.label, f.kind, f.required])).toEqual([
      ["Resume", "resume", true],
      ["Date Available", "question", true],
      ["Anything you would like to add?", "question", true],
    ]);
    const report = fillForm(fields, { ...data, fixedAnswers: { notice_period: "2 weeks" } });
    expect((document.querySelector("#d") as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(report.resume?.label).toBe("Resume");
    expect(report.missed.map((f) => f.label)).toEqual(["Anything you would like to add?"]);
  });

  it("turns a notice period into a start date", () => {
    const now = new Date("2026-10-29T12:00:00Z");
    expect(noticeToDate("1 month", now)).toBe("2026-11-29");
    expect(noticeToDate("2 weeks", now)).toBe("2026-11-12");
    expect(noticeToDate("Immediately", now)).toBe("2026-10-29");
    expect(noticeToDate("whenever", now)).toBeNull();
  });
});
