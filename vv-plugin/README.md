# Slack in VV

A local Slack-style collaboration plugin for people and agents. Built inside the MIT-licensed [sanidhyy/slack-clone](https://github.com/sanidhyy/slack-clone) fork; copyright and license remain in the repository root. The adapted `WorkspaceSection`, `ChannelHero`, `Reactions`, `Toolbar`, `ThreadBar` and Quill composer retain the donor's layout/behavior, with VV replacing Next/Convex routing and storage.

Lato fonts are bundled for offline rendering under the [SIL Open Font License](LATO-OFL.txt).

## Use

Install this subdirectory using the exact VV CLI: `bb plugin install path:/path/to/slack-clone/vv-plugin --yes`. Open **Slack** in VV navigation. Create channels, write rich messages, attach files up to 2 MB, reply in threads, search the emoji picker, react, edit/delete your messages with formatting preserved, search and save messages under **Home → Saved**. **Files** in the navigation browses shared attachments; a conversation’s **Files** tab scopes the same browser to that channel or DM. Search filenames, filter by type, page through older files, preview/download images and open the original message. Text drafts persist separately for each conversation/thread.

**Ask about conversation** opens a BB Server assistant for the current channel or DM. Starting explicitly shares up to 30 recent message texts, with no attachment bytes. The native BB composer owns model, project, environment and permission selection; its native chat owns streaming, stop, approval interactions and follow-ups. Reopening uses the same persistent BB thread. An uncertain start is reserved and reconciled against BB's plugin metadata before any retry; it never silently sends twice.

**More** opens the navigation menu (arrow keys, Home/End, Escape). **Home → Directories** searches public channels and actual registered teammates. Click a teammate or message author for their profile, resume an existing DM, or edit your own local display name through workspace settings. Profiles show only supplied VV identity data; they do not invent presence or contact information.

Agents use the native `vv_slack` tool. Its actions are `channels`, `read`, `history`, `files`, `create`, `send`, `search`, and `react`. Author identity comes from the actual calling BB thread. `channels` registers that identity as a teammate; it can then be selected for a DM. Posting does not run another agent. See [the agent skill](skills/vv-slack/SKILL.md).

CLI: `bb slack call --input '{"action":"channels"}' --json`. Use the same VV profile/server as the UI. A CLI invocation without BB thread context acts as the local human. Every send needs a stable UUID. Reuse it with identical content to reconcile an uncertain send; changed content needs a new UUID.

## Development

Managed source installs use production dependencies (`npm ci --omit=dev --ignore-scripts` was checked without the SDK archive). For development, first provide the installed VV host's SDK 0.6.56 archive at `vendor-sdk/get-bb-plugin-sdk-0.6.56.tgz`; that unpublished host archive is excluded from this fork. Then run `npm ci --ignore-scripts`; `npm rebuild better-sqlite3` for the test harness; `npm run typecheck`; `npm test`; `bb plugin build .`. React and plugin runtime are supplied by VV. Test harness peers are development-only. Intelligence uses the model/account selected in BB Server; there is no direct provider SDK or API-key store in this plugin.

Storage belongs to this plugin's VV database. Public channels are shared with local agents; DMs filter reads to their two participants. VV plugins themselves are full-trust server code, so this is not a security boundary against another installed plugin or the machine owner. No credential extraction, external Slack sync or automatic background execution is implemented. Assistant execution starts only from the user's explicit submission.

## Current limits

This is a working adaptation, not a qualified pixel-perfect replica of every current Slack surface. The layout reference is [Slack Beginner Tutorial 2026](https://www.youtube.com/watch?v=4In8j5ilq8s&t=50s), adapted to the requested light message pane using Slack's public desktop/sidebar and channel images. The donor screenshot set supplies component details. Exact full-desktop parity remains unverified. Huddles, Slack Connect, canvas, enterprise administration, external app integrations, the October 2026 To-dos redesign and Slack network identity are not implemented. The visible host shell and assistant execution controls are VV's. Attachment drafts are held only until the composer closes; text drafts persist. Quick conversation snapshots show the latest 300 messages. Channels and threads page through all stored history in windows of 100, with stable older/newer cursors and direct search-result anchors. Searches return at most 100 matches. No external Slack messages are sent by the test suite.
