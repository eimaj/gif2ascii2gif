# Delta for usage-events

## Purpose

Defines the anonymous usage counting behind the site: which events exist, which fields they may carry, what is never collected, and how the endpoint rejects abuse.

## ADDED Requirements

### Requirement: Event allowlist
The endpoint SHALL accept only these events: `convert`, `export_gif`, `export_player`, `blocked_too_large`. Any other event name SHALL be rejected with 400.

#### Scenario: Unknown event
- **WHEN** a request posts event `pageview`
- **THEN** the response is 400 and nothing is recorded

#### Scenario: Non-string event name
- **WHEN** a request posts event `["convert"]`
- **THEN** the response is 400 and nothing is recorded

### Requirement: Event fields
Events SHALL carry only enumerated, coarse fields: `input` (`file`, `drop`, `url`, `demo`), `width` bucket (`<=40`, `<=80`, `<=120`, `<=160`), and `frames` bucket (`<25`, `<50`, `<100`, `<=300`, `>300`). A field outside its enum, or any extra field, SHALL be rejected with 400.

#### Scenario: Free-text field
- **WHEN** a request includes a `url` field
- **THEN** the response is 400 and nothing is recorded

### Requirement: No personal data
The endpoint SHALL NOT record IP addresses, user agents, cookies, GIF URLs or file names, or any identifier that could link events to a person or to each other.

#### Scenario: Recorded data point
- **WHEN** a valid `convert` event is recorded
- **THEN** the stored data point contains only the event name and its enumerated fields

### Requirement: Same-origin only
The endpoint SHALL accept only POST requests whose `Origin` header matches the host the endpoint is served from, and SHALL reject others with 403 (wrong or missing origin) or 405 (wrong method). The allowed host SHALL come from the request, not from configuration in the repository.

#### Scenario: Cross-site request
- **WHEN** a request arrives with `Origin: https://evil.example`
- **THEN** the response is 403 and nothing is recorded

### Requirement: Bounded requests
The endpoint SHALL reject bodies larger than 512 bytes or not valid JSON with 400 or 413, without parsing beyond the limit.

#### Scenario: Oversized body
- **WHEN** a request body is 4 KB
- **THEN** the response is 413 and nothing is recorded

### Requirement: Fire-and-forget client
The page SHALL send events without waiting on the response, and a failed or rejected event SHALL NOT affect conversion or downloads.

#### Scenario: Endpoint unavailable
- **WHEN** the endpoint returns an error or the request fails
- **THEN** the converter keeps working and shows no error to the visitor

### Requirement: Missing storage binding
When the analytics storage binding is not configured, the endpoint SHALL respond 503 and record nothing, so local development and unconfigured previews fail visibly in the network panel rather than silently.

#### Scenario: Local development
- **WHEN** the site runs without the storage binding and a valid event is posted
- **THEN** the response is 503
