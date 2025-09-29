# Sync Pull Pagination

This document explains how the `/pull` synchronization endpoint returns batched
operations, how clients can influence pagination via query parameters, and how
to continue a multi-page pull.

## Endpoint overview

`GET /pull` returns the next slice of operations ("ops") that the client has
not yet applied. The response body conforms to the shared `PullResponse`
contract and contains:

- `ops`: ordered list of operations to apply.
- `newVersion`: highest version included in the response (or the caller's
  baseline if no rows were returned).
- `hasMore`: indicates whether additional operations are available beyond the
  `ops` payload.
- `continuationToken`: opaque cursor to resume fetching when `hasMore` is true.

Operations are sorted first by `version` and then by the internal metadata `id`
so pagination is deterministic.

## Query parameters

| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| `sinceVersion` | integer | stored device progress | Starting version (exclusive). If omitted the server reuses the persisted `last_version` for the requesting device. |
| `limit` | positive integer | `DEFAULT_PULL_LIMIT` (100) | Maximum number of ops to return. The server fetches one extra row to determine `hasMore`. |
| `deviceId` | string | `DEFAULT_PULL_DEVICE_ID` (`"unknown-device"`) | Used to track per-device progress (`last_version`, `last_meta_id`, and saved continuation tokens). |
| `continuationToken` | string | none | Resume pagination after a partial page. Must match the `version:id` format produced by the server (the identifier segment may be a UUID). |

### Interactions between parameters

- Providing `sinceVersion` resets the pagination baseline even if the server has
  stored progress from earlier pulls.
- When both `sinceVersion` and `continuationToken` are supplied, the server
  honors whichever represents the later position. This ensures clients cannot
  accidentally page backwards.
- If the client omits both `sinceVersion` and `continuationToken`, the server
  will reuse the most recently stored `continuationToken` for the given device.

## Continuation semantics

- Continuation tokens encode the last returned row as `"<version>:<metaId>"`, where `<metaId>` is the literal identifier from `sync_meta` (for example a UUID).
- When `hasMore` is `true`, clients **must** include the returned token on their
  subsequent `/pull` request to fetch the next page.
- The token remains persisted in `device_sync_progress` so a client can resume
  after reconnecting without replaying the entire history.
- When the server returns `hasMore: false`, the accompanying `continuationToken`
  is `null` and the persisted cursor is cleared.

## Recommended client flow

1. Call `GET /pull?deviceId=<id>` with any known `sinceVersion` and `limit`.
2. Apply the returned `ops` in order.
3. If `hasMore` is `true`, call `/pull` again with the provided
   `continuationToken` (and the same `deviceId`). Repeat until `hasMore` is
   `false`.
4. Persist the response's `newVersion` locally. This value should be supplied as
   `sinceVersion` on future sync sessions.

The server updates `device_sync_progress` after every successful pull so future
calls from the same device automatically resume at the correct point.
