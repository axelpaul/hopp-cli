# App operation inventory

## Evidence and extraction

Source: `data/hopp-discovery/current-disassembly.txt`, SHA-256 `0bc413b051d58b84c990d625945ee835e844ec8c59782dfeaf6d4ff67f0b806a`. This is saved Hermes disassembly, not current server introspection or observed execution. Documents were recovered from complete `LoadConstString` GraphQL strings. `sourceLine` is a one-based disassembly text line; `sourceLines` preserves repeated bytecode references.

`src/app-documents.json` contains 142 unique exact operation strings, representing 130 operation names, plus 23 unique exact fragment strings. Exact duplicates are deduplicated; same-name whitespace-only variants remain separate records so exact source text is retained. Variants with the same name normalize identically when whitespace is collapsed. Select a single variant per name in the CLI. There are 95 default customer operation names.

Each `document` preserves decoded string contents exactly, including whitespace; `composedDocument` appends required fragment texts transitively without rewriting any original text. All fragment references resolve. Where same-name fragment variants exist, the earliest source occurrence is chosen; variants differ only in whitespace. All 142 composed operation documents passed GraphQL parsing and the fragment-cycle, known-fragment, unused-fragment, unique-fragment-name, and unique-operation-name rules offline. This does not validate field names or input shapes against a server schema.

## Classification and execution boundaries

- `kind` is the GraphQL keyword; `effect` is behavioral classification, not inferred solely from that keyword.
- `RequestQuote` is a read-semantic mutation: requesting an ephemeral quote is not booking a ride. Quote generation may still allocate a backend quote record.
- `InitiateJumioWorkflow` is write-classified despite query syntax: it initializes KYC workflow/session material.
- `AdvancedAdyenPaymentSetup` is conservatively write-classified despite query syntax: payment setup is not a passive account read.
- `AddAppleAuth`, `AddGoogleAuth`, `AddPhoneAuth` are auth operations linking identities. They are not a complete login/token-refresh protocol.
- Other customer mutations, including locate/horn, position updates, log upload, tutorials, sign-up-region changes and issue reports, remain writes. No network or live write was executed for this inventory.
- No vehicle actuation, paid ride, payment, KYC, or account mutation is live-proven by static documents. Read classifications cannot rule out server analytics, query-side setup, or backend implementation effects.

## Required variable restrictions

Customer `Me` must force `isAdmin=false`; `SingleVehicle` and `MapItems` must force `adminMode=false`. The original documents contain admin-sensitive selections, retained exactly for evidence. Reject attempts to set those flags true through the default customer surface. Do not equate possession of an operation document with authorization.

## Variable schemas remain partial

`variableDeclarations` preserves exact operation variable declaration text. Parse it with a GraphQL AST for scalar/list/non-null/default structure. Those declarations recover input *type names*, not fields inside named input objects, enum member sets, custom scalar wire formats, accepted values, or business validation. Do not convert an unknown input object into a falsely complete strict schema or infer response-requiredness as request-requiredness. Nested input shapes require further callsite evidence or an authorized schema source. No complete schema was recovered here; the partial GraphQL library `IntrospectionQuery` string is excluded.

## Default customer operation names by effect

### Read (57)

`SimpleMe`; `Me`; `UserInfo`; `ServiceMessages`; `HasAcceptedTos`; `ReportIssueData`; `IssueTypesForVehicle`; `GetLicenseStatus`; `EnabledFeatures`; `VehicleTypes`; `getVehicleByCode`; `VehicleClusters`; `AllVehicles`; `GetTutorial`; `ChangedZones`; `Notifications`; `GetOrganizations`; `OrgInvite`; `Countries`; `PublicCouponGroup`; `MarketplaceOfferings`; `WalletInternals`; `PaymentMethods`; `SingleCoupon`; `TripDetails`; `FineDetails`; `TaxiTripDetails`; `Invoices`; `RideHistory`; `InvoiceHistory`; `allActiveTrips`; `getActiveTrips`; `allTrips`; `RentRequirements`; `AllParkingStatuses`; `TutorialsInRegion`; `getVehiclePhoto`; `ParkingRules`; `VehicleId`; `Vehicle`; `Region`; `AllRegions`; `SingleVehicle`; `PreRentInfo`; `Fleet`; `VehicleType`; `MapItems`; `ActiveTaxiTrip`; `autocompletePlace`; `autocomplete`; `RequestQuote`; `ReverseLookup`; `ReverseLookupMissingData`; `TaxiRegionVehicles`; `TripEnding`; `taxiTripRoute`; `UnratedTaxiTrip`.

### Write (35)

`ToggleVehicleLock`; `ToggleVehicleLocks`; `UploadLogs`; `AddSignUpRegion`; `UpdatePushToken`; `SwitchLocale`; `UpdateUser`; `RequestUserDeletion`; `AcceptTos`; `ReportIssues`; `InitiateJumioWorkflow`; `AddLicense`; `locateVehicle`; `JoinOrganization`; `SetPrimaryCard`; `PurchaseMarketplaceCoupon`; `RemoveCard`; `RedeemCoupon`; `RetryUnpaidInvoices`; `AdyenPaymentSetup`; `AdvancedAdyenPaymentSetup`; `AdyenSubmitCardInfo`; `AdyenSubmitPaymentDetails`; `rentVehicle`; `endRent`; `UnlockHelmet`; `UpdateTripPaymentMethod`; `endGroupRent`; `ReportParkingViolation`; `LogDemandLocation`; `CompleteTutorial`; `RiderCancelTrip`; `RateDriver`; `RequestTrip`; `UpdateRiderPosition`.

### Auth (3)

`AddAppleAuth`; `AddGoogleAuth`; `AddPhoneAuth`.

## Customer feature coverage

- Vehicle discovery: map clusters/items, regions/fleets/types, single-vehicle/code lookup, zones, photos, rules, requirements and price/pre-rent information.
- Scooter/car/group rentals: rent, active trips, parking state, helmet unlock, end rent/group rent, trip payment-method update and history/details. BLE/proprietary device communication is not established by these GraphQL documents.
- Taxi: autocomplete/reverse lookup, nearby taxi positions, quotes, requests, active trip/status/route/history, cancel, rating and rider-position updates. Streaming taxi updates are inventoried separately below.
- Wallet/payment: cards, primary/remove, payment-method availability, coupons/marketplace, redeem/purchase, unpaid-invoice retry, Adyen setup/submit/details, invoices and ride histories. PSP SDK/browser/3DS handoffs are separate protocols; raw card data handling is not established here.
- Account: identity profile/settings, locale/push tokens, TOS/deletion, license/KYC, auth linking, organization membership/invites.
- Customer support: issue types/reports, parking violation reports, service notifications, tutorials and diagnostics.

## Excluded from default customer surface

### staff (24)

`StartShift`; `EndShift`; `AddVehicleToActiveShift`; `getFinishedTrips`; `ChangeVehicleLockColor`; `FixIssues`; `ChangeIoT`; `ChangeQrCode`; `ParseIotBarcode`; `GetOpenIssuesForVehicle`; `AllParts`; `IssueTypes`; `AllFleets`; `AllRepairsForVehicle`; `UpdateVehicleStatus`; `UnlockBattery`; `MoveVehicleToFleet`; `VehicleApn`; `ChangeVehicleApn`; `RestartIot`; `getVehicleByCodeAdmin`; `AllAdminVehicles`; `StartVehicleCheckup`; `FinishVehicleCheckup`.

### organization-management (9)

`EditOrgUser`; `EditOrgUsers`; `OrgDetails`; `OrgCard`; `RemoveOrgUser`; `EditOrganization`; `OrgEditDetails`; `AddOrganization`; `RetryOrgPayments`.

### subscription (2)

`position`; `TripUpdate`.

Staff controls (including shifts, repairs, IoT/APN/QR/battery controls and vehicle checkups) are deliberately not default CLI commands. Organization-management operations concern company administration/billing and are separate from normal member invitation/join/read flows. Both require explicit product/scope decisions before exposure. Subscriptions `position` and `TripUpdate` are retained with composed documents but require independently recovered authenticated GraphQL WS/SSE transport, reconnect and lifecycle contracts before streaming execution.

## Limitations

This inventory is bounded to complete GraphQL string literals in one saved app disassembly. Dynamic/generated documents, REST endpoints, Firebase auth, media uploads, PSP SDK calls, BLE or other native modules may exist outside this set. Literal extraction is not proof of callsite reachability or role authorization. Three non-GraphQL disassembly string literals could not be decoded by the literal parser; this is not a claim that every string in the artifact was recovered. No credentials, tokens, app keys, user data or live response bodies were copied into these files.

## Rental pause/resume/reservation callsite follow-up

`ToggleVehicleLock` and `ToggleVehicleLocks` are customer operations despite their proximity to staff operation definitions. Functions21663/21664 (`apiLockVehicle`/`apiUnlockVehicle`), disassembly lines824778–824812, invoke `toggleVehicleLock(vehicle.id,true/false)`. Functions21342/21343 (`apiPauseAllTrips`/`apiUnpauseAllTrips`), lines815542–815570, invoke `toggleVehicleLocks(true/false)`. Apollo helpers19937/19941 construct `variables:{vehicleId,lock}` / `{lock}` for the recovered mutation documents. These pause/resume flows need no additional REST endpoint.

Reservation creation uses existing `rentVehicle` with `RentStatus.Reserved`: UI evidence lines1178383–1178384 and1277334–1277338; helper21328 lines815198–815260 forwards code, initialStatus, paymentMethod and user lat/lng to rentVehicle, with default RentStatus.Trip. Exact enum wire values must come from the current schema rather than CamelCase generated property identifiers. Reservation resume routes to `unpausing` (line822176), which uses existing customer lock toggles. Cancel reservation event routes to `cancelReserved.payment` (lines822184–822188); its final end-rent callchain was not fully followed in this bounded pass, so do not claim a separate cancel endpoint or zero fee. Existing endRent has payment/fee parameters; inspect state before choosing them.
