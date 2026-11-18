# HashTracks GitHub Apps

Two GitHub Apps replace the owner's personal token (ops plan S4; [`docs/ops/system.md#identity`](../../docs/ops/system.md#identity)).
The owner creates both, from the manifests in this folder.

| App | Manifest | Permissions | Used by |
|---|---|---|---|
| HashTracks Server | [`hashtracks-server.json`](hashtracks-server.json) | Issues: read and write. Pull requests, Contents, Metadata: read | The server on Vercel (`src/lib/github-app.ts`): issue filing, the audit mirror, kennel labels, alerts, feedback, rule drift, the watchdog and the digest |
| HashTracks Agent | [`hashtracks-agent.json`](hashtracks-agent.json) | Contents, Pull requests, Issues: read and write. Checks, Commit statuses, Metadata: read. **No** Workflows, Administration or Actions | The scheduled tasks on the Mac mini, through the agent root's `gh` shim (`infra/agent-root/`) |

Neither App has a webhook, and both are private to the owner's account. Install each on
`johnrclem/hashtracks-web` only. Approval checks use neither: they keep the read-only
`GITHUB_APPROVAL_READ_TOKEN`.

## Create an App

From a checkout of `main`, on the Mac:

1. `bash infra/github-apps/create-app.sh open infra/github-apps/<app>.json`. A local page opens; press
   **Create on GitHub**, then confirm the App on GitHub. If GitHub says the name is taken, pick
   another; the bot login changes with it (see below).
2. GitHub redirects to `https://www.hashtracks.xyz/?code=…`. Copy the code from the address bar.
3. Within the hour: `bash infra/github-apps/create-app.sh convert <code> <key-file>`. It saves the
   private key to `<key-file>` (mode 600) and prints the App's id and bot login, never the key.
4. On the App's settings page, **Install App** → your account → **Only select repositories** →
   `hashtracks-web`. The installation id is the number at the end of the page's address
   (`github.com/settings/installations/<id>`).

The bot login is `<slug>[bot]`, normally `hashtracks-server[bot]` and `hashtracks-agent[bot]`. If
the agent's differs, set it where the gate and the merge script read it (`AGENT_BOT_LOGIN`; see
`docs/ops/system.md#identity`).

## Server App: put it in Vercel

Production only, as Sensitive variables (from the project folder, with the Vercel CLI):

```bash
vercel env add GITHUB_APP_ID production
```

```bash
vercel env add GITHUB_APP_INSTALLATION_ID production
```

```bash
vercel env add GITHUB_APP_PRIVATE_KEY production < ~/hashtracks-server-app.pem
```

Then redeploy production, open `/admin/audit` and check the filing-health chip: it should say
"The server App can file issues". While it says "GITHUB_TOKEN fallback", the App isn't in use.
Delete the local key file once Vercel has it.

Once the chip is green: remove `GITHUB_TOKEN` from Vercel (Production and Preview) and redeploy.
The server never falls back to it once any `GITHUB_APP_*` variable is set. A later PR then deletes
the fallback from `src/lib/github-app.ts`.

## Agent App: put it on the Mac

Save the key into the agent root (for example `convert <code> ~/Developer/hashtracks-agents/.agent/app.pem`),
then follow `infra/agent-root/README.md`.
