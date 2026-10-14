// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ReceiverTemplate} from "./ReceiverTemplate.sol";

/**
 * @title CovenantRegistry
 * @notice On-chain record of legally significant SEC 8-K filings for issuers of tokenized debt / RWA.
 *         Only the Chainlink CRE forwarder can write (via ReceiverTemplate.onReport). A BREACH-severity filing
 *         (default: 1.03 bankruptcy, 2.04 acceleration, 3.01 delisting, 4.02 non-reliance) flags the issuer as in
 *         breach; any note that asks `isBreached(cik)` should halt transfers until the trustee (owner) cures it.
 * @dev Report = abi.encode(uint64 cik, bytes32 accessionHash, uint32 filingDate, uint32 itemsMask, uint8 severity, string accession)
 */
contract CovenantRegistry is ReceiverTemplate {
    uint8 public constant SEVERITY_INFO = 1;
    uint8 public constant SEVERITY_WATCH = 2;
    uint8 public constant SEVERITY_BREACH = 3;

    struct LegalEvent {
        bytes32 accessionHash;
        uint32 filingDate; // YYYYMMDD
        uint32 itemsMask; // bit i = i-th Form 8-K item (see edgar.ts ITEMS)
        uint8 severity;
        uint64 recordedAt;
    }

    mapping(bytes32 => bool) public seen; // accessionHash => already recorded
    mapping(uint64 => bool) public isBreached; // cik => breach flag (cleared only by trustee)
    mapping(uint64 => LegalEvent) public lastEvent; // cik => newest recorded event
    mapping(uint64 => uint256) public eventCount;

    event LegalEventRecorded(
        uint64 indexed cik, bytes32 indexed accessionHash, uint32 filingDate, uint32 itemsMask, uint8 severity, string accession
    );
    event BreachFlagged(uint64 indexed cik, bytes32 indexed accessionHash, uint32 itemsMask);
    event BreachCured(uint64 indexed cik, string note);
    event DuplicateIgnored(uint64 indexed cik, bytes32 indexed accessionHash);

    error BadSeverity(uint8 severity);

    constructor(address forwarder) ReceiverTemplate(forwarder) {}

    function _processReport(bytes calldata report) internal override {
        (uint64 cik, bytes32 accessionHash, uint32 filingDate, uint32 itemsMask, uint8 severity, string memory accession) =
            abi.decode(report, (uint64, bytes32, uint32, uint32, uint8, string));
        if (severity == 0 || severity > SEVERITY_BREACH) revert BadSeverity(severity);
        // Idempotent: DON retries / overlapping cron ticks must not double-count or re-flag a cured issuer.
        if (seen[accessionHash]) {
            emit DuplicateIgnored(cik, accessionHash);
            return;
        }
        seen[accessionHash] = true;
        eventCount[cik]++;
        if (filingDate >= lastEvent[cik].filingDate) {
            lastEvent[cik] = LegalEvent(accessionHash, filingDate, itemsMask, severity, uint64(block.timestamp));
        }
        emit LegalEventRecorded(cik, accessionHash, filingDate, itemsMask, severity, accession);
        if (severity == SEVERITY_BREACH && !isBreached[cik]) {
            isBreached[cik] = true;
            emit BreachFlagged(cik, accessionHash, itemsMask);
        }
    }

    /// @notice Trustee clears the breach flag (e.g. after a waiver or cure). A *new* breach filing re-flags it.
    function cure(uint64 cik, string calldata note) external onlyOwner {
        isBreached[cik] = false;
        emit BreachCured(cik, note);
    }
}
