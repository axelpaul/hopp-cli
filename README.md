# Hopp CLI + MCP

A local Bun CLI for Hopp car sharing, scooters, taxi quotes/bookings, account,
wallet, invoices, parking and support. Recovered from the official Android app
9.10.0 (401), checked against the live GraphQL schema on 2026-10-30.

**95 customer operations:** 57 reads, 35 writes and 3 authentication-linking
operations. SMS login/verification and refresh are also supported. The region-wide
`cars` command is an additional read. Staff/admin tools and organization management
are not exposed. This is not a claim that every workflow was executed.

## Install

```sh
bun install
bun run check
bun run build
./hopp --version
```

Source entry point: `bun src/index.ts`. `src/index.ts` has a Bun shebang.
The compiled binary works independently of its working directory.
Repository: https://github.com/axelpaul/hopp-cli. No release has been tagged.
Source install: `bun add -g github:axelpaul/hopp-cli`.

## Authentication and persistence

```sh
hopp doctor --json
HOPP_AUTH_ENABLE_WRITES=1 hopp login --phone +COUNTRY_AND_NUMBER --yes
# Supply the four-digit code on standard input; do not put it in arguments.
HOPP_AUTH_ENABLE_WRITES=1 hopp verify --yes
hopp refresh --yes
```

Without `--yes`, SMS commands preview and send nothing. Do not request another SMS
while one is pending. A local ten-minute pending guard is not a server cooldown.
`refresh` without `--yes` also previews. No automatic SMS is ever sent.

Access and refresh tokens are allowlisted into `~/.config/hopp-cli/auth.json`, outside
source/build folders, with directory mode 0700 and file mode 0600. XDG_CONFIG_HOME
is respected. Writes are atomic; unsafe symlink/hardlink paths are rejected.
A shared process lock prevents token refresh from racing login, import or logout. If a crashed process leaves
`session.lock`, confirm no refresh is running before removing that local lock.

The CLI refreshes shortly before the access token expires. After an authentication
rejection, a read may refresh and retry once. Mutations never replay automatically.
Rotated refresh tokens are saved. The live refresh endpoint and subsequent
identity read were verified with this compiled CLI.

**Persistence does not prevent server revocation.** Hopp can invalidate a session
when another device signs in. A revoked refresh token requires a fresh SMS login;
the CLI stops and reports that rather than repeatedly requesting codes.

`hopp logout` removes only the local session; it does not revoke an app login or
unset environment credentials. `hopp import-session` accepts normalized JSON
`accessToken`/`refreshToken` on stdin. Never put credentials in Git or examples.

## CLI usage

```sh
hopp cars --json
hopp cars --model buzz --json
hopp operations --json
hopp schema rentVehicle
hopp VehicleTypes --json
hopp RideHistory --variables '{"input":{"limit":10}}' --json
hopp RequestQuote --variables @private-quote-input.json --json
```

Every recovered customer operation is directly callable by its exact name. Use
`hopp schema NAME` for its complete variable/input-object schema; unknown fields,
wrong enum values and invalid coordinate bounds fail before transport. The source
service schema also retains enum values and provider-specific scalar names.
Opaque custom scalars cannot establish provider workflow semantics.

`cars` requests car sharing across the entire region, not the map centre. Region 1
is Reykjavík. It paginates, groups by model image and includes map links, plate,
status and range. This is the list visible to a normal account, not a fleet-owner
inventory of occupied, hidden or maintenance vehicles. Image-derived model names
are indications, not a VIN decode. An empty model match does not establish why
vehicles are absent.

### Writes

```sh
# Preview only; does NOT reserve:
hopp rentVehicle --variables '{"code":"SYNTHETIC_CODE","initialStatus":"RESERVED"}'
# Preview only; does NOT pause a car:
hopp ToggleVehicleLock --variables '{"vehicleId":123,"lock":true}'
```

Supply `--yes` only after reviewing the actual vehicle/trip, price, payment and
action. Writes include reserving/starting/ending rentals, pausing/resuming locks,
taxi booking/cancellation, payments, account deletion and profile changes.
`ToggleVehicleLock` uses `lock:true` to pause and `false` to resume. Reservation
creation uses `rentVehicle` with `RESERVED`; starting a rental uses `TRIP`.
Do not infer fee-free cancellation from `endRent`: check the service's actual
requirements/fees first. A timeout can leave the server outcome unknown; check
state before manually repeating a mutation.

Three auth-linking GraphQL operations are CLI-only and additionally require
`HOPP_AUTH_ENABLE_WRITES=1`. They are never published as MCP tools.

Two original app documents needed explicit live-schema adaptations: OrgInvite's
argument `id` is now `joinId`; RequestTrip's `paymentId` argument is now
`paymentMethod` (its CLI variable retains the recovered name). Original evidence
is preserved in app-documents.json; the legacy requestTrip field is deprecated by
the provider. No taxi booking was executed to verify that adapted workflow.

## MCP server

```json
{"mcpServers":{"hopp":{"command":"hopp","args":["serve"]}}}
```

Default: 58 read tools (57 recovered operations plus `hopp_cars`). Set
`HOPP_MCP_ENABLE_WRITES=1` for 35 additional write tools, 93 tools total.
Every write requires an explicit Boolean `confirm`: false previews, true executes.
There is no arbitrary-GraphQL tool and no auth/SMS tool. Stdio stdout contains only
the protocol. Schemas include nested inputs, nullable fields and enum constraints.

## Configuration

- `HOPP_CONFIG_DIR`: override the external private configuration directory.
- `XDG_CONFIG_HOME`: standard configuration root.
- `HOPP_ACCESS_TOKEN`: optional access-token override; no automatic refresh of it.
- `HOPP_AUTH_ENABLE_WRITES=1`: explicit CLI login/account-linking opt-in.
- `HOPP_MCP_ENABLE_WRITES=1`: expose MCP write tools; confirmation still required.

The API origin is fixed. Redirects are rejected, responses/timeouts are bounded,
and raw service errors are suppressed to avoid leaking private payloads.

## Development and verification

```sh
bun run check
bun run build
bun scripts/verify-mcp.ts
```

Tests cover every write/auth preview with zero fetch calls, session permissions
and symlinks, rotating refresh tokens, expiry refresh, bounded read retry,
revocation, no mutation replay, schemas, confirmation and nested redaction.
Compiled MCP discovery is checked with writes off/on and a reservation preview.

Live verified: persisted login, compiled doctor, explicit token refresh followed
by authenticated doctor, region-wide cars, vehicle types and schema introspection.
Not executed: rentals, reservations, taxi requests/cancellations, payments,
account deletion, OAuth linking, KYC/browser handoffs or new CLI SMS exchange.
The existing SMS proof supplied this CLI's initial saved session. Provider flows
requiring a browser or uploads may need additional caller steps; the CLI exposes
the recovered operations, not an invented complete browser automation flow.
Taxi subscriptions are retained as evidence but not yet implemented as bounded
stream commands. See [operation inventory](docs/OPERATION-INVENTORY.md).

MIT — Axel Paul Gunnarsson.
