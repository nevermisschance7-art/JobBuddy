// Alerts polling and autofill coordination come in prompt 10.
// Rule: this extension never clicks Submit.
chrome.runtime.onInstalled.addListener(() => {
  console.info("JobBuddy installed");
});
