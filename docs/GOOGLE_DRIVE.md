# Google Drive sync

todolisto keeps every PC in step through the Google Drive API. Each profile
signs in with its own Google account (work with the work account, personal
with the personal one) and gets a `todolisto/<profile>` folder in that
account's Drive. Local files stay the source of truth; Drive is the meeting
point.

## One-time setup: an OAuth client (about 10 minutes)

Google requires every app that talks to Drive to identify itself with an
OAuth client. You create it once, in your own Google Cloud project, and use
it on every PC.

1. Open https://console.cloud.google.com and create a project (any name,
   e.g. `todolisto`).
2. **APIs & Services → Library**: search *Google Drive API* and enable it.
3. **Google Auth Platform → Branding / OAuth consent screen**:
   - User type **External** (or **Internal** if you create the project in a
     Google Workspace organisation and only use that organisation's accounts).
   - App name `todolisto`, your e-mail as support and developer contact.
4. **Google Auth Platform → Data access (scopes)**: add
   `https://www.googleapis.com/auth/drive.file`, `openid` and
   `.../auth/userinfo.email`. These are non-sensitive scopes: no Google
   verification is needed.
5. **Google Auth Platform → Audience**: click **Publish app** so the status is
   *In production*. While an app stays in *Testing*, Google expires its
   refresh tokens after 7 days and you would have to sign in again every
   week. (In testing mode you would also have to add your accounts as test
   users.)
6. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   application type **Desktop app**, any name. Copy the **Client ID** and the
   **Client secret**.
7. In todolisto click the cloud button (top bar) → paste both values → **Save
   client**. Then, for each profile, **Connect Google account**: the browser
   opens, you pick the account for that profile, and the tab says the app is
   connected.

The client id and secret are stored in `config/settings.json` (a desktop
client secret is not confidential in Google's model; it only identifies the
app). Refresh tokens are stored in `config/secrets.bin`, encrypted with the
Windows Data Protection API for your Windows user, and are never synced.

## What syncs, and how

- Per profile: every session file (`*.jsonl`), its Markdown copy (`*.md`),
  `dictionary.txt` and `autocorrect.txt`. Settings and window position are
  per device and stay local.
- When: at start, every 30 seconds, when a session ends, and with **Sync now**.
- Nothing is ever deleted by sync, in either direction.
- A file changed on both sides is a conflict: your version wins and is
  uploaded, the other version is kept next to it as
  `<name>.conflict-<time>.<ext>` and the sync dialog lists it. Conflict copies
  are never uploaded.
- A session that is still open on another PC shows up in the history here as
  *open on \<that PC\>*, read-only, until that PC closes it (the automatic
  close after inactivity runs on the PC that owns the session).
- The sync state lives in `cache/sync/<profile>.json`. Deleting it forces a
  full comparison on the next round; nothing is lost.

## Troubleshooting

- **"Add the Google OAuth client id and secret first"**: step 7 was skipped.
- **"Google rejected the token request: invalid_grant"**: the refresh token
  expired (app left in *Testing*, step 5) or access was revoked. Disconnect
  and connect the profile again.
- **Sign-in blocked by your organisation**: a Google Workspace admin can
  block unverified third-party apps. Create the Cloud project *inside* the
  work organisation with user type **Internal**, or ask the admin to allow
  the app. Use that client for the work profile; it works for personal
  accounts too only if the consent screen is External.
- **HTTP 404 while syncing**: the Drive folder was removed or moved. The app
  forgets the folder ids and recreates them on the next round.
- **The app cannot open the browser**: copy the sign-in URL from the error
  message into any browser on the same PC; the redirect targets
  `127.0.0.1`, so it must run on the same machine.
