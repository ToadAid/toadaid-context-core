# Security Policy

ToadAid Context Core is an alpha context-infrastructure library. Security reports are welcome, especially when they involve integrity, provenance, isolation, or boundary failures.

## What to report

Please report issues such as:

- exact evidence being altered, truncated, or silently reclassified;
- retrieval crossing a metadata/session boundary;
- integrity checks accepting tampered source, chunk, projection, candidate, journal, receipt, ledger, or report state;
- structured host data entering model context unexpectedly;
- a Context Core surface gaining model, network, shell, wallet, trade, git-write, durable-memory-write, or authority-grant capability;
- denial-of-service behavior that defeats documented byte/work bounds.

## How to report

Prefer GitHub Private Vulnerability Reporting when it is available for this repository.

If private vulnerability reporting is unavailable, contact the ToadAid maintainers at `ToadaidDAO@gmail.com`. Do not include exploit details, credentials, private data, or proof-of-concept material in a public issue.

Please include the affected version or commit, the smallest reproducible case you can provide, expected behavior, observed behavior, and any integrity or authority boundary you believe is affected.

## Disclosure

Please allow maintainers a reasonable opportunity to investigate and prepare a fix before public disclosure.

## Security boundary

Context Core is intentionally zero-authority. It does not treat retrieved text, continuity material, receipts, or model-facing context as permission to execute tools or side effects.
