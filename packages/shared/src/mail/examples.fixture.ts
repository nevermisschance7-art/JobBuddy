// Realistic employer mails with the class each must get. Used by classify.test.ts and
// script.test.ts, so the TypeScript rules and the Apps Script copy are checked on the same mails.
import type { MailClass } from "./classify";

export type MailExample = {
  name: string;
  from: string;
  subject: string;
  body: string;
  want: MailClass;
};

export const MAIL_EXAMPLES: MailExample[] = [
  // Interviews and scheduling
  {
    name: "interview invite with Calendly link",
    from: "Jane Smith <jane@acme.com>",
    subject: "Next steps with Acme",
    body: "Hi Sam,\nThanks for applying for the Backend Engineer role. We'd love to chat. Please pick a slot here: https://calendly.com/acme-jane/30min\nBest, Jane",
    want: "interview",
  },
  {
    name: "GoodTime scheduling link",
    from: "Acme Recruiting <no-reply@goodtime.io>",
    subject: "Schedule your interview with Acme",
    body: "Hi Sam, please use the link below to choose times for your interview for the Senior Engineer position. https://app.goodtime.io/schedule/abc",
    want: "interview",
  },
  {
    name: "asks for availability",
    from: "Tom <tom@globex.io>",
    subject: "Re: Your application to Globex",
    body: "Hi Sam, thanks for your application. Could you share your availability for a 30 minute call with our engineering lead next week?",
    want: "interview",
  },
  {
    name: "book a time",
    from: "Initech Talent <talent@initech.com>",
    subject: "Initech: Platform Engineer",
    body: "Hello! We reviewed your profile for the Platform Engineer role and would like to talk. Book a time that suits you using the link below.",
    want: "interview",
  },
  {
    name: "schedule a call",
    from: "Hooli Hiring <hiring@hooli.xyz>",
    subject: "Let's schedule a call",
    body: "Hi Sam, thank you for your interest in the Data Engineer position. Let's schedule a call to get to know each other.",
    want: "interview",
  },
  {
    name: "interview invitation via Greenhouse",
    from: "Umbrella Recruiting <no-reply@us.greenhouse-mail.io>",
    subject: "Interview invitation: Software Engineer at Umbrella",
    body: "Hi Sam, we are pleased to invite you to a first interview for the Software Engineer role at Umbrella.",
    want: "interview",
  },
  {
    name: "German interview invitation",
    from: "Personal <jobs@beispiel.de>",
    subject: "Einladung zum Vorstellungsgespräch",
    body: "Hallo Sam, vielen Dank für Ihre Bewerbung. Wir möchten Sie gern zu einem Gespräch einladen.",
    want: "interview",
  },
  {
    name: "interview confirmed",
    from: "Acme Recruiting <recruiting@acme.com>",
    subject: "Your interview with Acme is confirmed",
    body: "Hi Sam, your interview for the Backend Engineer position is confirmed for Tuesday at 10:00.",
    want: "interview",
  },
  // Assessments
  {
    name: "HackerRank test",
    from: "Globex Hiring <hiring@globex.io>",
    subject: "Globex coding test",
    body: "Hi Sam, as the next step for the Backend role, please complete the test here: https://www.hackerrank.com/test/abc123. You have 7 days.",
    want: "assessment",
  },
  {
    name: "Codility invite",
    from: "Codility <no-reply@codility.com>",
    subject: "Initech has invited you to a Codility test",
    body: "Initech invited you to take a Codility test for the Software Engineer position. Start the test: https://app.codility.com/c/abc",
    want: "assessment",
  },
  {
    name: "TestGorilla assessment",
    from: "TestGorilla <noreply@testgorilla.com>",
    subject: "You're invited to an assessment by Hooli",
    body: "Hooli has invited you to complete an assessment for the Data Engineer role. Click to begin.",
    want: "assessment",
  },
  {
    name: "take-home task",
    from: "Lisa <lisa@umbrella.dev>",
    subject: "Umbrella: take-home exercise",
    body: "Hi Sam, thanks for the chat about the Frontend Engineer role! Attached is our take-home exercise. Please send it back within a week.",
    want: "assessment",
  },
  // Offers
  {
    name: "offer letter",
    from: "Acme People <people@acme.com>",
    subject: "Your offer from Acme",
    body: "Hi Sam, we are delighted to offer you the position of Backend Engineer. Your offer letter is attached.",
    want: "offer",
  },
  {
    name: "extend an offer",
    from: "Tom <tom@globex.io>",
    subject: "Great news",
    body: "Hi Sam, after speaking with the team we would like to extend you an offer for the Senior Engineer role.",
    want: "offer",
  },
  // Next steps
  {
    name: "moved to next stage",
    from: "Initech Recruiting <jobs@initech.com>",
    subject: "Update on your application",
    body: "Hi Sam, we were impressed by your background and would like to move you forward to the next stage of our process for the Platform Engineer role.",
    want: "next_step",
  },
  {
    name: "pleased to let you know",
    from: "Hooli <careers@hooli.xyz>",
    subject: "Your application for Data Engineer",
    body: "Dear Sam, we are pleased to let you know that the hiring manager would like to proceed with your application.",
    want: "next_step",
  },
  {
    name: "shortlisted",
    from: "Umbrella Talent <talent@umbrella.dev>",
    subject: "Good news about your application",
    body: "Hi Sam, you have been shortlisted for the Software Engineer position. We'll be in touch shortly with details.",
    want: "next_step",
  },
  // Rejections
  {
    name: "unfortunately",
    from: "Acme Recruiting <no-reply@ashbyhq.com>",
    subject: "Your application to Acme",
    body: "Hi Sam, thank you for your interest in Acme. Unfortunately, we have decided not to move forward with your application at this time.",
    want: "rejection",
  },
  {
    name: "rejection beats interview words",
    from: "Globex <jobs@globex.io>",
    subject: "Globex: Backend Engineer",
    body: "Hi Sam, thanks for applying. After careful review we will not move forward to the interview stage.",
    want: "rejection",
  },
  {
    name: "other candidates",
    from: "Initech Careers <careers@initech.com>",
    subject: "Initech application update",
    body: "Thank you for applying. We have decided to proceed with other candidates whose experience more closely matches the role.",
    want: "rejection",
  },
  {
    name: "position filled",
    from: "Hooli Jobs <jobs@hooli.xyz>",
    subject: "Data Engineer position",
    body: "Hi Sam, we wanted to let you know the position has been filled. We wish you the best of luck in your job search.",
    want: "rejection",
  },
  {
    name: "German rejection",
    from: "Recruiting <jobs@beispiel.de>",
    subject: "Ihre Bewerbung",
    body: "Sehr geehrter Sam, vielen Dank für Ihre Bewerbung. Leider müssen wir Ihnen mitteilen, dass wir uns für andere Kandidaten entschieden haben.",
    want: "rejection",
  },
  {
    name: "French rejection",
    from: "Recrutement <rh@exemple.fr>",
    subject: "Votre candidature",
    body: "Bonjour Sam, merci pour votre candidature. Malheureusement, nous ne pouvons pas donner suite à votre candidature.",
    want: "rejection",
  },
  {
    name: "Spanish rejection",
    from: "Talento <talento@ejemplo.es>",
    subject: "Tu candidatura",
    body: "Hola Sam, gracias por tu candidatura. Lamentablemente hemos decidido seguir con otros perfiles para este puesto.",
    want: "rejection",
  },
  // Receipts
  {
    name: "thank you for applying",
    from: "Acme <no-reply@lever.co>",
    subject: "Thank you for applying to Acme",
    body: "Hi Sam, thank you for applying for the Backend Engineer role. Our team will review your application and if your profile fits, we will reach out to schedule an interview.",
    want: "received",
  },
  {
    name: "we've received your application",
    from: "Globex Talent <talent@globex.io>",
    subject: "We've received your application",
    body: "Hi Sam, we've received your application for Senior Engineer. Next steps: our recruiters review every application and will contact you if there is a match.",
    want: "received",
  },
  {
    name: "application received subject",
    from: "Workday <initech@myworkday.com>",
    subject: "Application received: Platform Engineer",
    body: "Your application has been received. If you have been shortlisted, we will contact you within two weeks.",
    want: "received",
  },
  {
    name: "pleased to confirm receipt",
    from: "Hooli <careers@hooli.xyz>",
    subject: "Your application",
    body: "We are happy to let you know that we have received your application for the Data Engineer role.",
    want: "received",
  },
  {
    name: "German receipt",
    from: "Recruiting <jobs@beispiel.de>",
    subject: "Eingangsbestätigung Ihrer Bewerbung",
    body: "Vielen Dank für Ihre Bewerbung. Wir melden uns bald bei Ihnen.",
    want: "received",
  },
  // Job alerts, newsletters, unrelated
  {
    name: "LinkedIn job alert",
    from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
    subject: "Backend Engineer: Acme and 12 more jobs",
    body: "Schedule a call? Your job alert for Backend Engineer. Acme is hiring. Apply now. Interview tips inside.",
    want: "other",
  },
  {
    name: "Indeed alert",
    from: "Indeed <alert@indeed.com>",
    subject: "30+ new Python developer jobs",
    body: "Jobs you may like: Python Developer at Globex. Easily apply.",
    want: "other",
  },
  {
    name: "jobs you may like",
    from: "Otta <hello@otta.com>",
    subject: "Jobs you may like this week",
    body: "We found 8 new roles for you. Book a time with a career coach.",
    want: "other",
  },
  {
    name: "sales mail with booking link",
    from: "Sales <sales@saasco.com>",
    subject: "Quick demo?",
    body: "Hi Sam, book a time for a 15 minute demo: https://calendly.com/saasco/demo",
    want: "other",
  },
  {
    name: "newsletter",
    from: "Tech Weekly <news@techweekly.com>",
    subject: "Tech Weekly newsletter #42",
    body: "This week: hiring trends, interviews with founders and more.",
    want: "other",
  },
];
