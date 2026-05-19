# DOM-Aware Sandbox Flow and Pay URL Summary

## Outcome

The sandbox registration flow now waits for observable page state between the high-risk browser steps instead of immediately advancing after a click. Step 3, step 4, and step 5 wait for a target DOM state, a URL change, or a conservative 10-second timeout before the background runner continues.

The post-profile onboarding screens are now handled automatically. The background worker monitors for the purpose screen and clicks `Skip`, then monitors for the all-set screen and clicks `Continue`; the operator no longer needs to use the 25-second window manually.

The mailbox backend login is now a pre-step based on the configured mail API URL. The extension opens the `mailApiBaseUrl` origin, fills the independent mailbox UI password, and waits for login confirmation. The default mailbox UI password is `admini123` and is separate from the external API Key.

Step 6 now opens the session endpoint page and copies the full JSON from the rendered page. Step 7 opens `https://payurl.ark2.cn/`, fills the `Access Token 或 session JSON` textarea, and clicks the generate payment long-link button.

On the first extension load, the background worker opens the challenge raw gist userscript page once. The one-time guard is stored in `chrome.storage.local`, so browser restarts and service-worker reloads do not reopen it after the first successful open.

## Key Changes

- `content/sandbox-login-page.js`
  - Restored real ChatGPT/OpenAI host hard rejection in page-side session validation.
  - Added DOM state reporting for `email`, `code`, `profile`, and `session-ready`.
  - Removed premature step-complete reporting from submit/fill actions; background now owns completion after evidence waiting.
  - Uses a same-origin relative session request when the configured endpoint resolves to the current origin.

- `background.js`
  - Adds 10-second DOM/URL evidence waits after email submit, verification code submit, and profile submit.
  - Adds a fast interrupt handler that broadcasts `STOP_FLOW`, marks the current running step failed, and leaves the flow retryable.
  - Opens the configured mailbox UI and logs in with the independent mailbox UI password.
  - Opens the raw gist userscript URL once on first extension startup and records the local guard flag.
  - After profile submit, waits at least 25 seconds, clicks `Skip` on the purpose page, then clicks `Continue` on the all-set page when those screens appear.
  - Keeps mail detail fallback same-origin in the mailbox UI page, but no longer silently retries by POSTing `/login`.
  - Splits Pay URL page automation into a dedicated step 7.
  - Completion now syncs the `plus` tag before updating the local ledger.

- `shared/sandbox-session.js`
  - Explicitly rejects root OpenAI/ChatGPT hosts as well as their subdomains.

- `manifest.json` and `package.json`
  - Extension/project name changed to `Plus PP Helper` / `plus-pp-helper`.
  - Version bumped to `0.2.3`.

- `.github/workflows/release.yml`
  - Adds tag/manual release automation for `plus-pp-helper.zip` and `plus-pp-helper.crx`.

## Verification Notes

The code should be verified by reloading the unpacked extension in Chrome and running one sandbox account from a fresh browser state. The expected visible sequence is:

1. Mailbox UI opens from the configured API URL and logs in with `admini123` unless changed in settings.
2. Login page opens, email is submitted, and logs show a DOM/URL evidence wait.
3. Verification code is filled only after polling obtains a code; logs show another evidence wait.
4. Profile fields are filled, then session extraction waits/retries.
5. The purpose page is skipped and the all-set page is continued when present.
6. Session endpoint opens as a page and the full JSON is copied.
7. Pay URL page opens with the Session JSON pasted and the generate button clicked.
