# Mission control

A DSH session View for running a lead agent and its subagents as one team.

## Install

From GitHub, through the DSH plugin manager:

```
plugin_manager { action: "install_bundle", target: "github:ziyih8124-crypto/dsh-mission-control" }
```

Or install the local directory during development. Refresh the page after installing. Requires DSH 0.2.x with the Web UI.

## Where it lives

Open a session and switch the conversation View row to **Mission control / 任务指挥台**. The board is scoped to the session tree: the lead agent (the durable root of the current session) is the commander, and every durable subagent child appears as a card with its own task, live status, latest activity, token usage and working time.

## What the user can do

- **See the whole operation at a glance**: lead-agent card plus subagent cards, running/idle status, tree depth, tokens and elapsed working time.
- **Archive a subagent, with confirmation**: the *Archive* button asks inline before doing anything. A confirmed archive removes the card from the live grid and moves it into the **Archived** tray, from which *Restore* brings it back. Archiving uses the Workspace registry's durable archived-session set, so it survives a reload; running subagents are not offered the action (interrupt them first), and external children have no local session to archive.
- **Dispatch a new subagent at any time**: write the task (optionally a name) and press *Dispatch subagent*. The Host starts a real child through `ctx.subagents.startActivation` with `delivery: 'parent'`, so the child works independently and its settlement notice goes back to the lead agent.
- **Open any agent's conversation**: jumps to that session through the standard client session target (subagent address included).
- **Interrupt a running continuable child** with an inline confirmation.
- The board degrades to read-only when the Host API or the subagent service is unavailable; the tree still renders from the shared Client session snapshot.

## Architecture

| Half | Role |
|---|---|
| Host `index.js` | Auth-fenced `/mission-control/api` route: `capabilities`, `digest`, `spawn`, `interrupt`. Uses `ctx.connection.requestRejection`, `ctx.subagents`, `ctx.sessionController`, `ctx.sessions`, `ctx.agents`, and `ctx.sessionPersistence` for finished children. |
| Client `client.js` | Registers a `conversation.view` entry. Reads the tree from the parent-owned `subagentCatalog` projection plus the durable `byId` summaries, live status from `useSessionStatus`, and metrics from the `tokenUsage` / `subagentTiming` projections. Follows the shared Workspace model's `archivedSessionIds` to split live cards from the archived tray, and archives/restores through `ctx.uiWorkspace`. Polls only the latest task/output/tool digest every 3 s. |
| Locales | Client dictionary (zh/en) plus exported `meta.title` / `meta.description` for the Plugin Manager and Settings pages. |

No DSH package is imported at runtime; the Client uses React from the browser module table, and the Host reads services through `ctx.get` / `ctx.inject`.

### Reading finished children

A finished local child's session normally goes cold. The digest route first
folds the in-memory snapshot; for a cold session it opens a read handle through
`ctx.sessionPersistence`, reads only the tail (plus a small head window for the
task prompt), and caches the result against the persistence revision for 30
seconds. That is why a completed card still shows its final answer without
resuming the child.

## Requirements

- The `subagents` service and at least one provider (normally `spawn`) must be mounted.
- Archive and restore read the Workspace registry through `ctx.get('workspaces')` and call `ctx.uiWorkspace.archiveSession` / `unarchiveSession`. Without that service the board still renders; the archive action reports `error.archive-unavailable`.
- The lead agent must be live, or `sessionController.resolveAgent` must be able to resume it.
- Session persistence is required for local child delivery and cold resume. It is also what makes a finished child archivable.
- Delegation depth 0 disables dispatch (the plugin refuses with `error.depth-limit`).

## Notes

- The board never writes session events itself. A dispatched child is a normal subagent; its result reaches the lead agent through the framework's standard settlement notice.
- Archiving is the Harness's own durable archive of the child Session, not a board-only hide: the Host checks that no turn, job or descendant is still active, so a running card is not offered the action. Its subagent descendants leave the live grid with it (the Host's archived-session gate already blocks their steps) and return when it is restored. Restoring returns the Session to every surface that honours the archive set.
- Side-chat threads (`Side: ` durable titles) are excluded from the topology.
- External children have no local session; their cards are informational and cannot be opened or interrupted.

## Verification

- JavaScript syntax and manifest: `node --check index.js`, `node --check client.js`; both dictionaries carry every key the component uses.
- After installation, the live Client slot shows occupant `mission-control` in `conversation.view` (order 40).
- Verified in the running desktop GUI: the **指挥台 / Mission control** tab renders the lead card, four stats, the dispatch form, and a subagent card.
- Verified end to end: dispatching a trivial task from the form created a real child through `startActivation`, the child completed and reported to the lead agent, and the card showed its final answer after the session went cold.
- Verified `打开`: the card switched the conversation to the child session; the header breadcrumb returned to the lead.
- Not exercised end to end: the interrupt action (it needs a child that is still running), the external-child read-only path, and archive/restore (they need a finished local child and a live Workspace service).
- The Host route rejects an unauthenticated request with `403`; the browser page reaches it through the connection fence.
