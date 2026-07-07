// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Outcome} from "./IComplianceCheck.sol";

/// @title AttestationRegistry
/// @notice On-chain, transaction-linked compliance attestations. Records:
///           (a) per-transaction outcome attestations (PASS/FAIL/PENDING), and
///           (b) per-address source-of-funds (SoF) attestations produced by an
///               authorized compliance attestor after off-chain evidence review.
///         Tx outcomes are written by the PolicyWrapper / ComplianceEscrow
///         ("writers"); SoF attestations are written by "attestors". This is the
///         inspectable audit trail the paper's design produces at settlement.
contract AttestationRegistry is Ownable2Step {
    struct TxAttestation {
        Outcome outcome;
        bytes32 reason;
        uint64 timestamp;
        bool exists;
    }

    struct SoFAttestation {
        bytes32 evidenceHash; // hash of the off-chain source-of-funds evidence
        uint64 expiry; // attestation valid until this timestamp
        address attestor; // who vouched for it
    }

    mapping(bytes32 txId => TxAttestation) public txAttestations;
    mapping(address subject => SoFAttestation) public sofAttestations;

    /// @notice Contracts allowed to record tx outcomes (PolicyWrapper, Escrow).
    mapping(address => bool) public isWriter;
    /// @notice Keys allowed to record SoF attestations (compliance operators).
    mapping(address => bool) public isAttestor;

    event WriterSet(address indexed writer, bool allowed);
    event AttestorSet(address indexed attestor, bool allowed);
    event OutcomeRecorded(bytes32 indexed txId, Outcome outcome, bytes32 reason);
    event SoFRecorded(address indexed subject, bytes32 evidenceHash, uint64 expiry, address indexed attestor);
    event SoFRevoked(address indexed subject);

    error NotWriter(address caller);
    error NotAttestor(address caller);

    constructor(address owner_) Ownable(owner_) {}

    modifier onlyWriter() {
        if (!isWriter[msg.sender]) revert NotWriter(msg.sender);
        _;
    }

    modifier onlyAttestor() {
        if (msg.sender != owner() && !isAttestor[msg.sender]) revert NotAttestor(msg.sender);
        _;
    }

    // --- Admin ---------------------------------------------------------------

    function setWriter(address writer, bool allowed) external onlyOwner {
        isWriter[writer] = allowed;
        emit WriterSet(writer, allowed);
    }

    function setAttestor(address attestor, bool allowed) external onlyOwner {
        isAttestor[attestor] = allowed;
        emit AttestorSet(attestor, allowed);
    }

    // --- Writes --------------------------------------------------------------

    /// @notice Record (or update) the compliance outcome for a transaction. The
    ///         outcome may evolve over a transaction's life (PENDING → PASS once
    ///         SoF is provided and the escrowed tranche is released).
    function recordOutcome(bytes32 txId, Outcome outcome, bytes32 reason) external onlyWriter {
        txAttestations[txId] =
            TxAttestation({outcome: outcome, reason: reason, timestamp: uint64(block.timestamp), exists: true});
        emit OutcomeRecorded(txId, outcome, reason);
    }

    /// @notice Record a source-of-funds attestation for `subject`, valid until
    ///         `expiry`. Called after the compliance operator has reviewed the
    ///         off-chain evidence identified by `evidenceHash`.
    function recordSoF(address subject, bytes32 evidenceHash, uint64 expiry) external onlyAttestor {
        sofAttestations[subject] =
            SoFAttestation({evidenceHash: evidenceHash, expiry: expiry, attestor: msg.sender});
        emit SoFRecorded(subject, evidenceHash, expiry, msg.sender);
    }

    function revokeSoF(address subject) external onlyAttestor {
        delete sofAttestations[subject];
        emit SoFRevoked(subject);
    }

    // --- Reads ---------------------------------------------------------------

    /// @notice True if `subject` holds a non-expired SoF attestation.
    function hasValidSoF(address subject) external view returns (bool) {
        SoFAttestation storage s = sofAttestations[subject];
        return s.evidenceHash != bytes32(0) && s.expiry > block.timestamp;
    }
}
