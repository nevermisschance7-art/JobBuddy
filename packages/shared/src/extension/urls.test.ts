import { describe, expect, it } from "vitest";
import { jobKeyFromUrl } from "./urls";

describe("jobKeyFromUrl", () => {
  it.each([
    ["https://boards.greenhouse.io/acme/jobs/4012345", { ats: "greenhouse", id: "4012345" }],
    [
      "https://job-boards.greenhouse.io/acme/jobs/4012345?utm=x",
      { ats: "greenhouse", id: "4012345" },
    ],
    ["https://acme.com/careers/job?gh_jid=4012345", { ats: "greenhouse", id: "4012345" }],
    [
      "https://boards.greenhouse.io/embed/job_app?for=acme&token=4012345",
      { ats: "greenhouse", id: "4012345" },
    ],
    [
      "https://jobs.lever.co/acme/0F3B2C1D-1111-2222-3333-444455556666/apply",
      { ats: "lever", id: "0f3b2c1d-1111-2222-3333-444455556666" },
    ],
    [
      "https://jobs.ashbyhq.com/acme/0f3b2c1d-1111-2222-3333-444455556666/application",
      { ats: "ashby", id: "0f3b2c1d-1111-2222-3333-444455556666" },
    ],
    ["https://apply.workable.com/acme/j/AB12CD34EF/apply/", { ats: "workable", id: "ab12cd34ef" }],
    [
      "https://jobs.smartrecruiters.com/Acme/744000012345678-backend-engineer",
      { ats: "smartrecruiters", id: "744000012345678" },
    ],
  ])("%s", (url, key) => expect(jobKeyFromUrl(url)).toEqual(key));

  it("reads the SmartRecruiters apply form", () => {
    expect(
      jobKeyFromUrl(
        "https://jobs.smartrecruiters.com/oneclick-ui/company/Acme/publication/0f3b2c1d-1111-2222-3333-444455556666?dcr_ci=Acme",
      ),
    ).toEqual({ ats: "smartrecruiters", id: "0f3b2c1d-1111-2222-3333-444455556666" });
  });

  it("ignores other pages", () => {
    expect(jobKeyFromUrl("https://boards.greenhouse.io/acme")).toBeNull();
    expect(jobKeyFromUrl("https://www.linkedin.com/jobs/view/123")).toBeNull();
    expect(jobKeyFromUrl("not a url")).toBeNull();
  });
});
