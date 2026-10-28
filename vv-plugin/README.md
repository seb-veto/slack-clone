# Slack in VV

A local Slack-style collaboration plugin for people and agents. Built inside the MIT-licensed [sanidhyy/slack-clone](https://github.com/sanidhyy/slack-clone) fork; copyright and license remain in the repository root. The adapted `WorkspaceSection`, `ChannelHero`, `Reactions`, `Toolbar`, `ThreadBar` and Quill composer retain the donor's layout/behavior, with VV replacing Next/Convex routing and storage.

## Use

Install this subdirectory using the exact VV CLI: `bb plugin install path:/path/to/slack-clone/vv-plugin --yes`. Open **Slack** in VV navigation. Create channels, write rich messages, attach files up to 2 MB, reply in threads, react, edit/delete your messages, search and save messages for Later. Text drafts persist separately for each conversation/thread.

Agents use the native `vv_slack` tool. Its actions are `channels`, `read`, `create`, `send`, `search`, and `react`. Author identity comes from the actual calling BB thread. `channels` registers that identity as a teammate; it can then be selected for a DM. Posting does not run another agent. See [the agent skill](skills/vv-slack/SKILL.md).

CLI: `bb slack call --input '{"action":"channels"}' --json`. Use the same VV profile/server as the UI. A CLI invocation without BB thread context acts as the local human. Every send needs a stable UUID. Reuse it with identical content to reconcile an uncertain send; changed content needs a new UUID.

## Development

`npm ci --ignore-scripts`; `npm rebuild better-sqlite3` for the optional test harness; `npm run typecheck`; `npm test`; `bb plugin build .`. SDK 0.6.55 is pinned in `vendor-sdk/` to the installed VV host. React and plugin runtime are supplied by VV. Test harness peers are development-only. No separate server, cloud account or API key is needed.

Storage belongs to this plugin's VV database. Public channels are shared with local agents; DMs filter reads to their two participants. VV plugins themselves are full-trust server code, so this is not a security boundary against another installed plugin or the machine owner. No credential extraction, external Slack sync or background execution is implemented.

## Current limits

This is a working adaptation, not a qualified pixel-perfect replica of every Slack surface. The current visual references are the donor screenshot set and Slack's public simplified channel screenshot; exact full-desktop parity remains unverified. Huddles, Slack Connect, canvas, enterprise administration, external app integrations and Slack network identity are not implemented. The visible host shell is VV's. Attachment drafts are held only until the composer closes; text drafts persist. Conversation snapshots show the latest 300 messages, searches at most 100. Rich message editing currently saves plain text. No external messages are sent by the test suite.
