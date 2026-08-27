// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title Simple SSI-gated Voting contract
/// @notice Holds any number of elections. Voters present a Verifiable
///         Credential (a signature from a trusted issuer over their DID hash,
///         bound to this contract). The contract checks the credential is
///         genuine and that the DID has not voted in that election yet.
/// @dev    A vote also requires an approval signature from a separate
///         confirmation wallet, which the issuer bound to the DID when it
///         issued the credential. The voting device holds the key that sends
///         the transaction, but it cannot produce that approval, so malware on
///         the voting device cannot cast or alter a ballot on its own.
contract Voting {
    address public issuer;          // address of the SSI credential issuer

    struct Election {
        string name;
        string[] candidates;
    }

    Election[] private elections;

    // electionId => didHash => voted?
    mapping(uint256 => mapping(bytes32 => bool)) public hasVoted;

    // electionId => candidateId => vote count
    mapping(uint256 => mapping(uint256 => uint256)) private tally;

    /// EIP-712 typed data. The ballot is signed as a struct that carries the
    /// election and candidate *names*, so the confirmation wallet shows the
    /// voter what they are approving in clear text rather than an opaque hash.
    /// Both names are taken from on-chain storage here, so a voting device that
    /// swaps the candidate produces a digest the voter never signed. The
    /// election id is part of the struct too, so an approval for one election
    /// cannot be replayed into another.
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant BALLOT_TYPEHASH = keccak256(
        "Ballot(uint256 electionId,string election,bytes32 didHash,uint256 candidateId,string candidate)"
    );

    event ElectionCreated(uint256 indexed electionId, string name);
    event VoteCast(uint256 indexed electionId, bytes32 indexed didHash, uint256 candidateId);

    constructor(address _issuer, string[] memory _candidates) {
        issuer = _issuer;
        _createElection("General Election", _candidates);
    }

    /// @notice Open a new election. Anyone may do this — see the README, a real
    ///         deployment would restrict it to an election authority.
    function createElection(string memory name, string[] memory candidateNames)
        external
        returns (uint256)
    {
        return _createElection(name, candidateNames);
    }

    function _createElection(string memory name, string[] memory candidateNames)
        internal
        returns (uint256)
    {
        require(bytes(name).length > 0, "Election needs a name");
        require(candidateNames.length >= 2, "Need at least two options");

        for (uint256 i = 0; i < candidateNames.length; i++) {
            require(bytes(candidateNames[i]).length > 0, "Option needs a name");
        }

        elections.push(Election(name, candidateNames));

        uint256 electionId = elections.length - 1;
        emit ElectionCreated(electionId, name);

        return electionId;
    }

    function electionCount() external view returns (uint256) {
        return elections.length;
    }

    /// @notice Every election's name, plus how many options each one has.
    function getElections()
        external
        view
        returns (string[] memory names, uint256[] memory optionCounts)
    {
        names = new string[](elections.length);
        optionCounts = new uint256[](elections.length);

        for (uint256 i = 0; i < elections.length; i++) {
            names[i] = elections[i].name;
            optionCounts[i] = elections[i].candidates.length;
        }
    }

    /// @notice Cast a vote in one election.
    /// @param confirmAddress  the voter's confirmation wallet.
    /// @param credentialSig   the issuer's signature over
    ///        keccak256(didHash, confirmAddress, address(this)) — the voter's
    ///        Verifiable Credential. It proves they are eligible to vote here
    ///        *and* names the only wallet allowed to approve their ballots, so
    ///        the confirmation wallet cannot be swapped either.
    /// @param confirmSig      the confirmation wallet's EIP-712 signature over
    ///        the Ballot struct, i.e. explicit approval of this exact vote.
    function vote(
        uint256 electionId,
        bytes32 didHash,
        uint256 candidateId,
        address confirmAddress,
        bytes memory credentialSig,
        bytes memory confirmSig
    ) external {
        require(electionId < elections.length, "Invalid election");
        require(candidateId < elections[electionId].candidates.length, "Invalid candidate");
        require(!hasVoted[electionId][didHash], "Identity has already voted");
        require(confirmAddress != address(0), "Missing confirmation wallet");

        bytes32 msgHash = keccak256(abi.encodePacked(didHash, confirmAddress, address(this)));
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash)
        );
        require(_recover(ethSignedHash, credentialSig) == issuer, "Invalid SSI credential");

        require(
            _recover(ballotDigest(electionId, didHash, candidateId), confirmSig) == confirmAddress,
            "Ballot not approved by confirmation wallet"
        );

        hasVoted[electionId][didHash] = true;
        tally[electionId][candidateId] += 1;

        emit VoteCast(electionId, didHash, candidateId);
    }

    /// @notice The EIP-712 digest the confirmation wallet has to sign to
    ///         approve one specific ballot.
    function ballotDigest(uint256 electionId, bytes32 didHash, uint256 candidateId)
        public
        view
        returns (bytes32)
    {
        require(electionId < elections.length, "Invalid election");
        require(candidateId < elections[electionId].candidates.length, "Invalid candidate");

        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("SSI Voting")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );

        bytes32 structHash = keccak256(
            abi.encode(
                BALLOT_TYPEHASH,
                electionId,
                keccak256(bytes(elections[electionId].name)),
                didHash,
                candidateId,
                keccak256(bytes(elections[electionId].candidates[candidateId]))
            )
        );

        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function getResults(uint256 electionId)
        external
        view
        returns (string[] memory, uint256[] memory)
    {
        require(electionId < elections.length, "Invalid election");

        Election storage election = elections[electionId];

        uint256[] memory results = new uint256[](election.candidates.length);
        for (uint256 i = 0; i < election.candidates.length; i++) {
            results[i] = tally[electionId][i];
        }

        return (election.candidates, results);
    }

    function _recover(bytes32 hash, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65, "Bad signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        return ecrecover(hash, v, r, s);
    }
}
