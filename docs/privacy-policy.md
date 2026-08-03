---
title: Privacy Policy — Threads Engager
---

# Privacy Policy — Threads Engager

**Last updated: 2026-08-03**

Threads Engager ("the Software") is an open-source, **self-hosted** tool that helps a single
Threads account owner draft, review, and publish their own content, and review replies before
sending them. The source code is public at
<https://github.com/1071107xznw-lang/threads-engager>.

## Who operates this

There is **no hosted service and no operator-run server**. Each user downloads the Software and
runs it on their own computer, connecting it to **their own** Threads account. The authors of the
Software never receive, see, or store any user data. "We" below refers to the Software's behaviour
on the user's own machine.

## What data the Software handles

When you connect your own Threads account, the Software works with:

| Data | Why | Where it is stored |
|---|---|---|
| Your Threads access token and user ID | To call the Threads API as you | `data.db` on your own computer |
| Your own posts (text, timestamps, permalinks) | Tone samples for drafting; performance ranking | `data.db` |
| Insights for **your own** posts (views, likes, replies, reposts, quotes) | To show which of your posts performed well | `data.db` |
| Public replies left on **your own** posts (text, username, permalink) | So you can review and reply to them | `data.db` |
| Public posts returned by Threads keyword search | Candidate posts you may choose to reply to | `data.db` |
| Draft text you or the AI assistant produce | Held for your review before you approve it | `data.db` |

`data.db` is a local SQLite file in the Software's own folder. It is not uploaded anywhere, and it
is excluded from the public source repository.

## What the Software does NOT do

- It does **not** transmit your data to the Software's authors or to any analytics service.
- It does **not** sell, rent, or share your data with third parties.
- It does **not** use browser automation, scraping, or any means of accessing Threads other than
  the official Meta Threads API.
- It does **not** send anything to Threads on your behalf without your explicit, per-item approval
  in the review dashboard (see below).
- It does **not** collect data about anyone other than the account owner, beyond the public post
  and reply content the Threads API returns for content you choose to review.

## Human review before anything is sent

Every outbound reply must be approved by the account owner, one item at a time, in a local review
dashboard. Automation stops at the "draft" stage. Scheduled publishing applies only to the account
owner's **own** posts that the owner has already approved.

## Third-party processing: AI drafting

Drafting is optional. If enabled, the Software passes the following to the **Claude command-line
tool installed on your own computer**, which sends it to Anthropic for processing:

- your brand persona and knowledge-base text (content you wrote),
- the text of your own recent posts,
- the text of public posts or replies you are considering replying to,
- public trending topics and news headlines.

Anthropic's handling of that text is governed by Anthropic's own privacy policy
(<https://www.anthropic.com/legal/privacy>). Access tokens and credentials are **never** sent to
the AI assistant. If you do not install the Claude CLI, the Software still works and you write all
content manually — no data leaves your computer at all.

## Retention and deletion

The Software keeps data until you delete it. You are in full control:

- **Disconnect your account** — use "切換帳號 / Switch account" in the dashboard. This clears the
  stored credentials and access token from `data.db`.
- **Delete everything** — quit the Software and delete the `data.db` file (and the `config/`
  folder). Nothing is retained elsewhere, because nothing was sent elsewhere.
- **Revoke access at Meta** — you can remove the app's access to your Threads account at any time
  from your Threads or Meta account settings, independently of this Software.

There is no server-side account to close and no deletion request to file with anyone, because no
copy of your data exists outside your own computer.

## Children

The Software is a business tool for account owners and is not directed at children under 13.

## Changes

Changes to this policy will be published at this URL, with the "Last updated" date revised. The
document's history is publicly auditable in the Git repository.

## Contact

Questions about this policy: open an issue at
<https://github.com/1071107xznw-lang/threads-engager/issues>.
