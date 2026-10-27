// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { FillData } from "../types";
import {
  classify,
  collectFields,
  fillForm,
  formQuestions,
  isConfirmation,
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
    document.body.innerHTML = lever + "<p>Thanks for your interest in Acme</p>";
    expect(isConfirmation(document, "https://jobs.lever.co/acme/123/apply")).toBe(false);
  });
});
