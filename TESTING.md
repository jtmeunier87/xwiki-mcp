# Testing xwiki-mcp

There are two levels of testing:

1. **CI**, on every push and pull request: `npm run build`, `npm test` (unit tests, mocked fetch) and `npm run test:integration`. The integration suite runs the built server against the official XWiki Docker images (current LTS and stable). It writes everything under a fresh space, `IT.Run<timestamp>`.
2. **Deployment live test**, run by whoever deploys a release. It runs every tool against the real wiki the server is deployed to, with that wiki's version, rights, extensions and proxy in front. It catches what CI can't: real data, real rights, a real link index, and a real reverse proxy or gateway.

This file covers both levels: the rules for the live test, the order its steps run in, and what to do with a failure. The plan below uses neutral names only. A deployment keeps its own notes (which space, which real pages to read) in its own private docs, never in this repo.

## Where issues go

- **In this repo:** tool bugs, missing features, test gaps, release work and the epics that group them. Write them generically: no real space, page, class, user or host names. Use the neutral examples from `CLAUDE.md`.
- **In the deployer's own tracker:** anything specific to one wiki, such as its classes, its data, its stack, or a decision only its owner can make (for example whether to set `rest.allowedQueryTypes`).
- When a live test finds a tool bug, open an issue here with a neutral reproduction. Link to it from the deployment's tracker, never the other way round.

## Rules for the live test

1. **Stop if it is not current.** Before step 1, check all of these:
   - The deployed server is the latest release. `/health` (or the server's `initialize` / `server/discover` answer) shows the same version as the latest `v*` tag.
   - No fix from an earlier test is waiting outside `master`. There are no open fix branches or pull requests for earlier findings, and every finding in the previous report is either fixed in a release or accepted.
   - The session was started after the deployment, so the client loaded the current tool list.

   If any of these fails, **stop**. Don't test an old build. Report what is out of date, then merge, release and redeploy first.
2. **One throwaway space, empty at the start.** The deployer names it, for example `Sandbox.MCPTest`. Before step 1, `xwiki_list_pages` on it must return nothing. If it holds pages, stop and ask: never reuse or clean up someone else's pages.
3. **Writes only in the throwaway space.** Every page, class, object, attachment and comment the test creates goes there. Reads elsewhere stay read-only, so pages outside the space are never changed. Never test a class change on a class that real data uses: the test makes its own class in the space.
4. **Create pages only as the plan says.** Use only the fixture names in the plan, in its order, and don't add pages along the way. If a fixture step fails, stop: later steps depend on it. When an extra page is needed to narrow a failure down, name it in the report.
5. **Read back every write.** A write passes only when a read call shows the saved values, not when the write call reports success.
6. **Delete tools stay off.** The deployer deletes the page the restore step needs, and deletes the space at the end.
7. **Record every step.** For each step, record ✅ or ❌ with what came back, in the order the steps ran. A step not run is listed as not run, with the reason.

## Test order

The order is fixed, because later steps use what earlier steps built:

1. **Before:** the current-version checks (rule 1), the tool list, one read call, and the empty space.
2. **Fixtures:** pages, then content edits, tags, comments, attachments, the class and its properties, then objects.
3. **Reads:** every read tool, on the fixtures, plus a read-only look at one real page tree and one real page with a script.
4. **Writes that keep pages:** copy, then moves (link check first), restore, attachment moves, tag removal, comment edit, property disable / enable, and rollback last.
5. **Protocol:** errors come back as tool errors, and the client shows the annotations.
6. **After:** report, update the deployment's docs, and leave the space for the deployer to delete.

## How to fix a failure

1. Reproduce it with neutral names. Find the root cause: the tool's code, or XWiki's own behaviour that the tool must handle or document.
2. Open an issue here: what was called, what came back, what should have come back.
3. Fix it on a branch with a unit test, and with a live test in `src/integration/live.itest.ts` if the tool writes or uses a `/bin/` action.
4. Open a pull request, wait until CI and Integration are green, and **merge it into `master` in the same cycle**. A fix left on a side branch never reaches a release. This rule exists because that happened once.
5. Bump the version (`package.json`, `package-lock.json`, `src/version.ts`, `server.json`) and add a line to the README Roadmap. The deployer tags the release, and the tag publishes the image.
6. Redeploy and start a new session. Rerun the steps that failed. If tool names, inputs or outputs changed, run the whole plan again in an empty space.

When XWiki's behaviour can't be changed from the tool (for example untyped links that a rename leaves unchanged), the tool must say so in its result or its description, never report success it didn't check. The deployer records any workaround in their own docs.

## Live test plan

`S` is the throwaway space. The plan uses every tool a deployment registers with delete off (48). Every test page is created in `S` by the steps below.

### Before
| # | Check | Pass |
|---|---|---|
| 0a | Rule 1: deployed version = latest tag; no fix waiting outside `master`; new session | All true, else stop |
| 0b | The session lists the expected `xwiki_` tools and none of `xwiki_delete_*` | Count and names match the README |
| 0c | `xwiki_list_spaces` | Answers (first read call) |
| 0d | `xwiki_list_pages` on `S` | Empty, else stop |

### Fixtures
| # | Tool and input | Pass |
|---|---|---|
| 1 | `xwiki_create_page`: `S.WebHome` "Test"; `S.Source` "Source"; `S.Target` "Target"; `S.Nested.WebHome` titled `Nested` (title equals name, for step 26); `S.Nested.Child` "Nested Child"; `S.Links` with an untyped `[[Target>>S.Target]]`; `S.TypedLinks` with a typed `[[Target>>doc:S.Target]]` | Each returns `created` |
| 2 | `xwiki_get_page` on each | Title, content and parent as written; `modified_date` is ISO |
| 3 | `xwiki_update_page` `S.Source`: add a second line | Version 2.1 |
| 4 | `xwiki_add_tags` `S.Source` `[t-a, t-b, t-c]`; `xwiki_get_page_tags` | Three tags |
| 5 | `xwiki_add_comment` "original", then a reply with `reply_to`; `xwiki_list_comments` | Two comments; the reply's `reply_to` is set; dates ISO |
| 6 | `xwiki_upload_attachment` `S.Source` `a.png`, then again with a different PNG; `S.Links` `m.png` | URLs carry no `?rev=` |
| 7 | `xwiki_update_page` `S.Links`: add `[[image:m.png]]` | Saved |
| 8 | `xwiki_create_page` `S.TestClass`; `xwiki_add_class_property` `field1` String and `pick` Page | Both added |
| 9 | `xwiki_update_class_properties` `field1` prettyName "Field one" | Reads back in `xwiki_get_class` |
| 10 | `xwiki_create_object` on `S.Source`, class `S.TestClass`, `field1` "v1", `pick` `S.Target` | `xwiki_get_object` shows both values |
| 11 | `xwiki_update_object` `field1` "v2"; `xwiki_get_object_property` `field1` | "v2" |

### Reads
| # | Tool and input | Pass |
|---|---|---|
| 12 | `xwiki_list_page_children` `S.WebHome` | The direct children |
| 13 | `xwiki_get_page_tree` `S.WebHome`, `parentchild` and `nestedpages`; then read-only on one real page tree | Every fixture with level and `classes`; the real tree shows its pages' classes |
| 14 | `xwiki_find_pages` name `Source`, space `S` | Finds `S.Source` |
| 15 | `xwiki_search_pages` "Nested Child"; `xwiki_query` solr `space:"S" AND type:DOCUMENT` | Both find the fixtures (Solr may need a minute); dates ISO |
| 16 | `xwiki_query` xwql `where doc.space = 'S'` | Results, or a 400 that names the allowed types |
| 17 | `xwiki_list_page_versions` `S.Source`, then `S.Missing` | Versions newest first; the missing page is a tool error "Page not found" |
| 18 | `xwiki_get_page_version` `S.Source` 1.1 | The first content |
| 19 | `xwiki_compare_page_versions` 1.1 → 2.1, then 1.1 → current | The added line; each side's version and date match `xwiki_list_page_versions` |
| 20 | `xwiki_list_attachments`; `xwiki_list_attachment_versions` `a.png` | Two versions, newest first; dates ISO |
| 21 | `xwiki_download_attachment` `a.png` | Returned as an image (the second PNG) |
| 22 | `xwiki_search_attachments` by `name`, by `types: image`, by `space: S` | Finds the fixtures |
| 23 | `xwiki_list_classes` `limit: 5`, then `start: 5`; `xwiki_get_class` `S.TestClass`; `xwiki_list_class_objects` with and without properties; `xwiki_list_class_property_values` `pick` filter `Target` | 5 classes with `total`, then the next page; no `headline: null`; `S.Target` among the values |
| 24 | `xwiki_list_page_objects` `S.Source` | Tag, comment and test-class objects |
| 25 | `xwiki_list_tags`; `xwiki_list_pages_by_tag` `t-a`; `xwiki_list_recent_changes`; `xwiki_get_required_rights` on `S.Source` and on one real page with a Velocity macro; `xwiki_render_page` `S.Nested.Child`; `xwiki_export_page` `S.Nested.WebHome` as pdf, xar and html | Tags include the fixtures; recent changes name the fixture pages; required rights empty for `S.Source` (no `right: ""`) and script for the Velocity page; render returns the text; pdf and xar come back as files; html returns `pages` and `files_omitted`, not a multi-MB zip |

### Writes that keep pages
| # | Tool and input | Pass |
|---|---|---|
| 26 | `xwiki_copy_page` `S.Source` → `S.SourceCopy`; `S.Nested.WebHome` → `S.NestedCopy.WebHome` with `children: true` | Content, tags, attachments, comments and objects copied; the nested copy is titled `Nested` and has `Child` |
| 27 | Wait until `xwiki_query` solr `links_extended:"entity:document:xwiki:S.Target"` lists `S.Links` and `S.TypedLinks`; then `xwiki_move_page` `S.Target` → `S.Renamed` | `backlinks_found` ≥ 2; `S.TypedLinks` rewritten; if `S.Links` (untyped) is not rewritten, it is named in `links_not_updated` with `links_updated: false`; title still "Target" |
| 28 | `xwiki_move_page` `S.NestedCopy.WebHome` → `S.Moved.WebHome`, `auto_redirect: true` | `S.Moved.Child` exists; `S.NestedCopy.WebHome` holds `XWiki.RedirectClass` |
| 29 | Create `S.Fresh` with `[[Renamed>>doc:S.Renamed]]` and move `S.Renamed` → `S.Renamed2` at once | `S.Fresh` rewritten, or named in `links_not_updated` (never a silent pass) |
| 30 | Deployer deletes `S.SourceCopy`; `xwiki_list_deleted_pages` name `S`; `xwiki_restore_deleted_page` with its id; the same id again | Listed with an id; restored with content and objects; the second restore is a tool error |
| 31 | `xwiki_move_attachment` `S.Links` `m.png` → `m2.png`, then → `S.Renamed2` | Each time the image reference in `S.Links` is rewritten |
| 32 | `xwiki_remove_tags` `S.Source` `[t-b, t-missing]` | `t-b` removed; `t-missing` in `not_found`; `t-a` and `t-c` stay |
| 33 | `xwiki_update_comment` the first comment | Text changed; author and date unchanged |
| 34 | `xwiki_set_class_property_enabled` `S.TestClass` `field1` false, then true | `disabled` reads back 1, then 0 |
| 35 | `xwiki_rollback_page` `S.Source` to 1.1 | A new version with the 1.1 content |

### Protocol
| # | Check | Pass |
|---|---|---|
| 36 | Every expected failure above came back as a tool error, not a failed call | Yes |
| 37 | In the client: a read tool runs without a confirmation prompt; `xwiki_move_page` shows as destructive | As described |

### After
Report every step (rule 7). Open an issue here for each tool bug ("How to fix a failure"). Leave `S` for the deployer to delete.
