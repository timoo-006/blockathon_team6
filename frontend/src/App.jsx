import React, { useEffect, useState } from "react";
import { ethers } from "ethers";

const RPC_URL = "http://localhost:8545";
const ISSUER_API = "http://localhost:4000/api";

const CONTRACT_ADDRESS =
  "0x5FbDB2315678afecb367f032d93F642f64180aa3";

const STORAGE_KEY = "ssi_voting_identity";
const PENDING_KEY = "ssi_voting_pending_request";

/*
 * Demo admin password.
 *
 * This only hides the create-election form in the UI. It is not
 * access control: the password ships in the bundle, and
 * createElection() on the contract is open to anyone. See the
 * README — restricting it for real means gating the contract call.
 */
const ADMIN_PASSWORD = "123";

/*
 * Shown next to the confirmation once a vote is recorded.
 *
 * Swap this for any direct image URL (one ending in .jpg / .png /
 * .webp) or a file you drop in the frontend. A link to an article
 * page will not work here — the browser needs the image itself.
 * If the URL fails to load, the image is simply hidden.
 */
const CELEBRATION_IMAGE = "https://i.pinimg.com/736x/0c/71/ff/0c71ff3e357f8c4023c85491644741bc.jpg"

/*
 * The local chain the confirmation wallet has to be on for its
 * EIP-712 signature to match the contract's domain separator.
 */
const CHAIN_ID = 31337;
const CHAIN_ID_HEX = "0x7a69";

const CONTRACT_ABI = [
  "function vote(uint256 electionId, bytes32 didHash, uint256 candidateId, address confirmAddress, bytes credentialSig, bytes confirmSig) external",
  "function createElection(string name, string[] candidateNames) external returns (uint256)",
  "function getElections() view returns (string[], uint256[])",
  "function hasVoted(uint256, bytes32) view returns (bool)",
  "function getResults(uint256 electionId) view returns (string[], uint256[])",
  "event VoteCast(uint256 indexed electionId, bytes32 indexed didHash, uint256 candidateId)"
];

const provider = new ethers.JsonRpcProvider(RPC_URL);

const contract = new ethers.Contract(
  CONTRACT_ADDRESS,
  CONTRACT_ABI,
  provider
);

/*
 * EIP-712 definition of a ballot approval.
 *
 * Signing typed data (rather than a raw hash) means the wallet
 * displays the candidate name in clear text, so the voter can see
 * what they are approving on the confirmation device itself.
 */
const BALLOT_DOMAIN = {
  name: "SSI Voting",
  version: "1",
  chainId: CHAIN_ID,
  verifyingContract: CONTRACT_ADDRESS
};

const BALLOT_TYPES = {
  Ballot: [
    { name: "electionId", type: "uint256" },
    { name: "election", type: "string" },
    { name: "didHash", type: "bytes32" },
    { name: "candidateId", type: "uint256" },
    { name: "candidate", type: "string" }
  ]
};

/*
 * Connect the separate confirmation wallet (MetaMask or any other
 * injected wallet) and make sure it is on the local election chain,
 * otherwise its EIP-712 signature would not match the contract's
 * domain separator.
 */
async function getConfirmationWallet() {
  const injected = window.ethereum;

  if (!injected) {
    throw new Error(
      "No wallet detected. Install a wallet (e.g. MetaMask) to use as your confirmation device."
    );
  }

  await injected.request({
    method: "eth_requestAccounts"
  });

  const currentChain = await injected.request({
    method: "eth_chainId"
  });

  if (currentChain !== CHAIN_ID_HEX) {
    try {
      await injected.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }]
      });
    } catch {
      /*
       * The wallet does not know this network yet.
       */
      await injected.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CHAIN_ID_HEX,
            chainName: "SSI Voting (local)",
            rpcUrls: [RPC_URL],
            nativeCurrency: {
              name: "Ether",
              symbol: "ETH",
              decimals: 18
            }
          }
        ]
      });
    }
  }

  const signer = await new ethers.BrowserProvider(
    injected
  ).getSigner();

  return signer;
}


function App() {
  const [activeTab, setActiveTab] = useState("identity");

  const [identity, setIdentity] = useState(null);
  const [voterName, setVoterName] = useState("");
  const [pendingRequest, setPendingRequest] = useState(null);
  const [requests, setRequests] = useState([]);

  const [elections, setElections] = useState([]);
  const [selectedElection, setSelectedElection] = useState(null);

  const [newElectionName, setNewElectionName] = useState("");
  const [newElectionOptions, setNewElectionOptions] = useState("");
  const [electionMessage, setElectionMessage] = useState("");
  const [loadingElection, setLoadingElection] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminMessage, setAdminMessage] = useState("");

  const [candidates, setCandidates] = useState([]);
  const [selectedCandidate, setSelectedCandidate] = useState(null);

  const [voteResult, setVoteResult] = useState("");
  const [voteSubmitted, setVoteSubmitted] = useState(false);
  const [identityMessage, setIdentityMessage] = useState("");

  const [loadingIdentity, setLoadingIdentity] = useState(false);
  const [loadingVote, setLoadingVote] = useState(false);
  const [loadingResults, setLoadingResults] = useState(false);

  const [results, setResults] = useState([]);
  const [votes, setVotes] = useState([]);

  const [search, setSearch] = useState("");

  /*
   * Load identity from localStorage.
   */
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (stored) {
      try {
        setIdentity(JSON.parse(stored));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }

      return;
    }

    /*
     * No identity yet — but there may be a registration
     * still waiting for an administrator.
     */
    const pending = localStorage.getItem(PENDING_KEY);

    if (pending) {
      try {
        setPendingRequest(JSON.parse(pending));
      } catch {
        localStorage.removeItem(PENDING_KEY);
      }
    }
  }, []);

  /*
   * While a registration is pending, watch for approval.
   */
  useEffect(() => {
    if (!pendingRequest) return;

    checkApproval(pendingRequest, true);

    const timer = setInterval(
      () => checkApproval(pendingRequest, true),
      4000
    );

    return () => clearInterval(timer);
  }, [pendingRequest]);

  /*
   * Admin: keep the registration list fresh while signed in.
   */
  useEffect(() => {
    if (activeTab !== "admin" || !isAdmin) return;

    loadRequests();

    const timer = setInterval(loadRequests, 4000);

    return () => clearInterval(timer);
  }, [activeTab, isAdmin]);

  /*
   * Load the election list when opening the Elections tab.
   */
  useEffect(() => {
    if (
      activeTab === "elections" ||
      activeTab === "admin"
    ) {
      loadElections();
    }
  }, [activeTab]);

  /*
   * Load candidates when opening Vote tab.
   */
  useEffect(() => {
    if (activeTab === "vote") {
      loadCandidates();
    }
  }, [activeTab, selectedElection]);

  /*
   * Load blockchain results when opening Results tab.
   */
  useEffect(() => {
    if (activeTab === "results") {
      loadResults();
    }
  }, [activeTab, selectedElection]);

  /*
   * Generate DID and ask an administrator to approve it.
   *
   * No credential is issued here — the issuer only records the
   * request. checkApproval() picks up the credential once an
   * admin has approved it.
   */
  async function requestIdentity() {
    if (!voterName.trim()) {
      setIdentityMessage("Please enter your name.");
      return;
    }

    setLoadingIdentity(true);
    setIdentityMessage("");

    try {
      /*
       * Connect the confirmation wallet first — the credential is
       * bound to it, so from here on this identity can only vote
       * with that wallet's approval.
       */
      setIdentityMessage(
        "Connect the wallet you want to use as your confirmation device..."
      );

      const confirmSigner = await getConfirmationWallet();

      const confirmAddress = await confirmSigner.getAddress();

      /*
       * Generate the wallet locally.
       *
       * The private key never gets sent to the issuer.
       */
      const wallet = ethers.Wallet.createRandom();

      const did = `did:ethr:${wallet.address}`;

      const didHash = ethers.keccak256(
        ethers.toUtf8Bytes(did)
      );

      setIdentityMessage(
        "Generating your identity and submitting it for approval..."
      );

      /*
       * Register with the issuer.
       */
      const response = await fetch(
        `${ISSUER_API}/requests`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            name: voterName.trim(),
            didHash,
            confirmAddress
          })
        }
      );

      let data;

      try {
        data = await response.json();
      } catch {
        throw new Error(
          "Issuer returned an invalid response."
        );
      }

      if (!response.ok) {
        throw new Error(
          data.error || "Issuer rejected the request."
        );
      }

      /*
       * Keep the keypair with the request, so a page reload
       * does not lose the identity being approved.
       */
      const request = {
        requestId: data.id,
        name: data.name,
        privateKey: wallet.privateKey,
        did,
        didHash,
        confirmAddress
      };

      localStorage.setItem(
        PENDING_KEY,
        JSON.stringify(request)
      );

      setPendingRequest(request);

      setVoterName("");

      setIdentityMessage(
        "Registration submitted. Waiting for an administrator to approve you."
      );

    } catch (error) {
      console.error(error);

      setIdentityMessage(
        `Error: ${error.message}`
      );
    } finally {
      setLoadingIdentity(false);
    }
  }

  /*
   * Has an admin approved us yet? If so, take the credential.
   */
  async function checkApproval(request, quiet) {
    if (!request) return;

    try {
      const response = await fetch(
        `${ISSUER_API}/requests/${request.requestId}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not read your request."
        );
      }

      if (data.status === "rejected") {
        localStorage.removeItem(PENDING_KEY);

        setPendingRequest(null);

        setIdentityMessage(
          "Your registration was rejected. You can register again."
        );

        return;
      }

      if (data.status !== "approved") {
        if (!quiet) {
          setIdentityMessage(
            "Still waiting for an administrator to approve you."
          );
        }

        return;
      }

      /*
       * Approved — store the finished identity.
       */
      const newIdentity = {
        privateKey: request.privateKey,
        did: request.did,
        didHash: request.didHash,
        confirmAddress: request.confirmAddress,
        name: request.name,
        credentialSig: data.credentialSig
      };

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(newIdentity)
      );

      localStorage.removeItem(PENDING_KEY);

      setPendingRequest(null);
      setIdentity(newIdentity);

      setIdentityMessage(
        "You were approved. Identity successfully created."
      );

    } catch (error) {
      console.error(error);

      if (!quiet) {
        setIdentityMessage(
          `Error: ${error.message}`
        );
      }
    }
  }

  /*
   * Admin: load every registration request.
   */
  async function loadRequests() {
    try {
      const response = await fetch(
        `${ISSUER_API}/admin/requests`,
        {
          headers: {
            "x-admin-password": ADMIN_PASSWORD
          }
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not load requests."
        );
      }

      setRequests(data);

    } catch (error) {
      console.error(error);

      setAdminMessage(
        `Could not load registrations: ${error.message}`
      );
    }
  }

  /*
   * Admin: approve or reject one request.
   */
  async function decideRequest(requestId, decision) {
    try {
      const response = await fetch(
        `${ISSUER_API}/admin/requests/${requestId}/${decision}`,
        {
          method: "POST",

          headers: {
            "x-admin-password": ADMIN_PASSWORD
          }
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "The issuer rejected that."
        );
      }

      setAdminMessage(
        `${data.name} (#${data.id}) is now ${data.status}.`
      );

      await loadRequests();

    } catch (error) {
      console.error(error);

      setAdminMessage(
        `Error: ${error.message}`
      );
    }
  }

  /*
   * Drop a registration that is still waiting.
   */
  function cancelRequest() {
    localStorage.removeItem(PENDING_KEY);

    setPendingRequest(null);
    setIdentityMessage("");
  }

  /*
   * Delete current identity.
   */
  function forgetIdentity() {
    const confirmed = window.confirm(
      "Forget this identity? You will have to register again and be approved by an administrator."
    );

    if (!confirmed) return;

    localStorage.removeItem(STORAGE_KEY);

    setIdentity(null);
    setSelectedCandidate(null);
    setVoteResult("");
    setVoteSubmitted(false);
    setIdentityMessage("");
  }

  /*
   * Unlock the admin view that holds the create-election form.
   */
  function adminLogin() {
    if (adminPassword !== ADMIN_PASSWORD) {
      setAdminMessage("Wrong password.");
      return;
    }

    setIsAdmin(true);
    setAdminPassword("");
    setAdminMessage("");
  }

  function adminLogout() {
    setIsAdmin(false);
    setNewElectionName("");
    setNewElectionOptions("");
    setElectionMessage("");
    setAdminMessage("");
    setRequests([]);
  }

  /*
   * Load the list of elections from the blockchain.
   */
  async function loadElections() {
    try {
      const [names, optionCounts] =
        await contract.getElections();

      setElections(
        names.map((name, index) => ({
          id: index,
          name,
          optionCount: Number(optionCounts[index])
        }))
      );

    } catch (error) {
      console.error(error);

      setElectionMessage(
        `Could not load elections: ${error.message}`
      );
    }
  }

  /*
   * Open a new election.
   *
   * Sent from a throwaway wallet: the local chain runs at
   * gasPrice 0, so an unfunded key can transact.
   */
  async function createElection() {
    const options = newElectionOptions
      .split("\n")
      .map((option) => option.trim())
      .filter((option) => option.length > 0);

    if (!newElectionName.trim()) {
      setElectionMessage("Please name the election.");
      return;
    }

    if (options.length < 2) {
      setElectionMessage(
        "Please enter at least two options, one per line."
      );
      return;
    }

    setLoadingElection(true);
    setElectionMessage("Creating election...");

    try {
      const tx = await contract
        .connect(
          ethers.Wallet.createRandom().connect(provider)
        )
        .createElection(
          newElectionName.trim(),
          options,
          { gasPrice: 0 }
        );

      await tx.wait();

      setNewElectionName("");
      setNewElectionOptions("");

      await loadElections();

      /*
       * Creating is an administrative act, so nothing here
       * touches the voter's current selection.
       */
      const [names] = await contract.getElections();

      setElectionMessage(
        `Election created: ${names[names.length - 1]} (#${names.length - 1}). Voters can now select it on the Elections tab.`
      );

    } catch (error) {
      console.error(error);

      setElectionMessage(
        `Error: ${
          error.shortMessage ||
          error.reason ||
          error.message
        }`
      );

    } finally {
      setLoadingElection(false);
    }
  }

  /*
   * Switching election clears anything tied to the previous one.
   */
  function selectElection(electionId) {
    setSelectedElection(electionId);
    setSelectedCandidate(null);
    setCandidates([]);
    setVoteResult("");
    setVoteSubmitted(false);
  }

  /*
   * Load candidates of the selected election.
   */
  async function loadCandidates() {
    if (selectedElection === null) return;

    try {
      const [candidateNames] =
        await contract.getResults(selectedElection);

      setCandidates(
        candidateNames.map((name, index) => ({
          id: index,
          name
        }))
      );

      /*
       * Check whether current DID already voted here.
       */
      if (identity) {
        const alreadyVoted =
          await contract.hasVoted(
            selectedElection,
            identity.didHash
          );

        if (alreadyVoted) {
          setVoteSubmitted(true);

          setVoteResult(
            "This identity has already voted in this election."
          );
        }
      }

    } catch (error) {
      console.error(error);

      setVoteResult(
        `Could not load candidates: ${error.message}`
      );
    }
  }

  /*
   * Submit vote directly from voter wallet.
   */
  async function castVote() {
    if (!identity) {
      setVoteResult(
        "You need to request an identity first."
      );
      return;
    }

    if (selectedElection === null) {
      setVoteResult(
        "Please select an election first."
      );
      return;
    }

    if (selectedCandidate === null) {
      setVoteResult(
        "Please select a candidate."
      );
      return;
    }

    if (!identity.confirmAddress) {
      setVoteResult(
        "This identity was created without a confirmation wallet. Forget it and redeem a new access code."
      );
      return;
    }

    setLoadingVote(true);

    try {
      /*
       * Get the ballot approved by the confirmation wallet before
       * anything is transmitted.
       *
       * The voting device cannot produce this signature, and the
       * contract rejects the vote without it — so malware here can
       * neither cast a ballot nor change the one being approved.
       */
      setVoteResult(
        "Approve this ballot in your confirmation wallet..."
      );

      const confirmSigner = await getConfirmationWallet();

      const connectedAddress =
        await confirmSigner.getAddress();

      if (
        connectedAddress.toLowerCase() !==
        identity.confirmAddress.toLowerCase()
      ) {
        setVoteResult(
          `Wrong wallet account. This identity is bound to ${identity.confirmAddress}. Switch to that account and try again.`
        );
        return;
      }

      const confirmSig = await confirmSigner.signTypedData(
        BALLOT_DOMAIN,
        BALLOT_TYPES,
        {
          electionId: selectedElection,
          election:
            elections.find(
              (election) =>
                election.id === selectedElection
            )?.name || "",
          didHash: identity.didHash,
          candidateId: selectedCandidate,
          candidate:
            candidates.find(
              (candidate) =>
                candidate.id === selectedCandidate
            )?.name || ""
        }
      );

      setVoteResult(
        "Ballot approved. Signing and submitting your vote..."
      );

      /*
       * Recreate the wallet from the locally stored
       * private key.
       */
      const voterWallet = new ethers.Wallet(
        identity.privateKey,
        provider
      );

      /*
       * Connect contract to voter wallet.
       */
      const voterContract = new ethers.Contract(
        CONTRACT_ADDRESS,
        CONTRACT_ABI,
        voterWallet
      );

      /*
       * Submit transaction directly to blockchain.
       */
      const tx = await voterContract.vote(
        selectedElection,
        identity.didHash,
        selectedCandidate,
        identity.confirmAddress,
        identity.credentialSig,
        confirmSig,
        {
          gasPrice: 0
        }
      );

      setVoteResult(
        "Transaction submitted. Waiting for confirmation..."
      );

      const receipt = await tx.wait();

      setVoteSubmitted(true);

      setVoteResult(
        `Vote successfully recorded!\n\nTransaction: ${receipt.hash}\nBlock: ${receipt.blockNumber}`
      );

    } catch (error) {
      console.error(error);

      setVoteResult(
        `Error: ${
          error.shortMessage ||
          error.reason ||
          error.message
        }`
      );

    } finally {
      setLoadingVote(false);
    }
  }

  /*
   * Read results and VoteCast events.
   */
  async function loadResults() {
    if (selectedElection === null) {
      setResults([]);
      setVotes([]);
      return;
    }

    setLoadingResults(true);

    try {
      const [candidateNames, tally] =
        await contract.getResults(selectedElection);

      const formattedResults =
        candidateNames.map((name, index) => ({
          name,
          votes: Number(tally[index])
        }));

      setResults(formattedResults);

      /*
       * Retrieve the VoteCast events of this election.
       */
      const events = await contract.queryFilter(
        contract.filters.VoteCast(selectedElection),
        0,
        "latest"
      );

      const formattedVotes = events.map((event) => ({
        didHash: event.args.didHash,
        candidateId: Number(event.args.candidateId),
        txHash: event.transactionHash,
        blockNumber: event.blockNumber
      }));

      setVotes(formattedVotes);

    } catch (error) {
      console.error(error);

      setResults([]);
      setVotes([]);
    } finally {
      setLoadingResults(false);
    }
  }

  /*
   * Search transactions.
   */
  const filteredVotes = votes.filter((vote) => {
    const query = search
      .trim()
      .toLowerCase();

    if (!query) return true;

    return (
      vote.txHash
        .toLowerCase()
        .includes(query) ||
      vote.didHash
        .toLowerCase()
        .includes(query)
    );
  });

  return (
    <div className="app">

      {/* HEADER */}

      <header className="header">

        <h1>
          SSI Blockchain Voting
        </h1>

        <nav className="nav">

          <button
            className={
              activeTab === "identity"
                ? "nav-button active"
                : "nav-button"
            }
            onClick={() =>
              setActiveTab("identity")
            }
          >
            1. Identity
          </button>

          <button
            className={
              activeTab === "elections"
                ? "nav-button active"
                : "nav-button"
            }
            onClick={() =>
              setActiveTab("elections")
            }
          >
            2. Elections
          </button>

          <button
            className={
              activeTab === "vote"
                ? "nav-button active"
                : "nav-button"
            }
            onClick={() =>
              setActiveTab("vote")
            }
          >
            3. Vote
          </button>

          <button
            className={
              activeTab === "results"
                ? "nav-button active"
                : "nav-button"
            }
            onClick={() =>
              setActiveTab("results")
            }
          >
            4. Results
          </button>

          <button
            className={
              activeTab === "admin"
                ? "nav-button admin active"
                : "nav-button admin"
            }
            onClick={() =>
              setActiveTab("admin")
            }
          >
            Admin
          </button>

        </nav>

      </header>


      <main className="main">

        {/* ================= IDENTITY ================= */}

        {activeTab === "identity" && (

          <section className="card">

            <h2>
              Self-Sovereign Identity
            </h2>

            <p>
              Register with your name. An administrator
              checks the request, and only then does the
              issuer sign your Verifiable Credential. You
              also need a wallet (e.g. MetaMask) — it
              becomes your confirmation device, and the
              credential is bound to it, so every ballot
              from this identity must be approved there.
            </p>

            {!identity && !pendingRequest ? (

              <div>

                <label>
                  Your name
                </label>

                <input
                  type="text"
                  value={voterName}
                  onChange={(event) =>
                    setVoterName(
                      event.target.value
                    )
                  }
                  placeholder="Ada Lovelace"
                  autoComplete="off"
                />

                <button
                  className="primary-button"
                  onClick={requestIdentity}
                  disabled={loadingIdentity}
                >
                  {loadingIdentity
                    ? "Submitting..."
                    : "Request Identity"}
                </button>

                {identityMessage && (
                  <div className="message">
                    {identityMessage}
                  </div>
                )}

              </div>

            ) : !identity ? (

              <div>

                <div className="warning-box">
                  Waiting for approval of{" "}
                  <strong>{pendingRequest.name}</strong>{" "}
                  (request #{pendingRequest.requestId}). An
                  administrator has to approve you before
                  your credential is issued. This page
                  checks every few seconds.
                </div>

                <div className="step-nav">

                  <button
                    className="primary-button"
                    onClick={() =>
                      checkApproval(pendingRequest, false)
                    }
                  >
                    Check now
                  </button>

                  <button
                    className="secondary-button"
                    onClick={cancelRequest}
                  >
                    Cancel Request
                  </button>

                </div>

                {identityMessage && (
                  <div className="message">
                    {identityMessage}
                  </div>
                )}

              </div>

            ) : (

              <div>

                <div className="success-box">
                  Identity successfully created.
                </div>

                <div className="identity-box">

                  <strong>Approved Voter</strong>

                  <code>
                    {identity.name || "—"}
                  </code>

                  <strong>DID</strong>

                  <code>
                    {identity.did}
                  </code>

                  <strong>DID Hash</strong>

                  <code>
                    {identity.didHash}
                  </code>

                  <strong>Confirmation Wallet</strong>

                  <code>
                    {identity.confirmAddress ||
                      "none — forget this identity and redeem a new code"}
                  </code>

                  <strong>Credential Signature</strong>

                  <code className="long-code">
                    {identity.credentialSig}
                  </code>

                </div>

                <p className="small">
                  Your private key is stored locally
                  in this browser and is not displayed.
                </p>

                <div className="step-nav">

                  <button
                    className="primary-button"
                    onClick={() =>
                      setActiveTab("elections")
                    }
                  >
                    Continue to Elections →
                  </button>

                  <button
                    className="secondary-button"
                    onClick={forgetIdentity}
                  >
                    Forget Identity
                  </button>

                </div>

              </div>

            )}

          </section>

        )}


        {/* ================= ELECTIONS ================= */}

        {activeTab === "elections" && (

          <section className="card">

            <h2>
              Elections
            </h2>

            <p>
              Pick the election you want to vote in.
              Elections live in the same contract; each
              identity may cast one vote in each of them.
              New elections are opened by an administrator
              in the Admin view.
            </p>

            <div className="candidates">

              {elections.length === 0 ? (

                <p className="small">
                  No elections yet.
                </p>

              ) : (

                elections.map((election) => (

                  <label
                    key={election.id}
                    className={
                      selectedElection === election.id
                        ? "candidate selected"
                        : "candidate"
                    }
                  >

                    <input
                      type="radio"
                      name="election"
                      value={election.id}
                      checked={
                        selectedElection === election.id
                      }
                      onChange={() =>
                        selectElection(election.id)
                      }
                    />

                    <span>
                      {election.name}{" "}
                      <span className="small">
                        ({election.optionCount} options)
                      </span>
                    </span>

                  </label>

                ))

              )}

            </div>

            <div className="step-nav">

              <button
                className="primary-button"
                onClick={() => setActiveTab("vote")}
                disabled={selectedElection === null}
              >
                Continue to Vote →
              </button>

              <button
                className="secondary-button"
                onClick={loadElections}
              >
                Refresh
              </button>

            </div>

          </section>

        )}


        {/* ================= ADMIN ================= */}

        {activeTab === "admin" && (

          <section className="card">

            <h2>
              Administration
            </h2>

            <p>
              Separate from the voting flow. Elections
              opened here become available to voters on
              the Elections tab.
            </p>

            <div className="admin-box">

              {!isAdmin ? (

                <>

                  <h3>
                    Administrator sign-in
                  </h3>

                  <p className="small">
                    Opening a new election is reserved for
                    election administrators.
                  </p>

                  <label>
                    Admin password
                  </label>

                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(event) =>
                      setAdminPassword(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        adminLogin();
                      }
                    }}
                    placeholder="••••"
                  />

                  <button
                    className="secondary-button"
                    onClick={adminLogin}
                  >
                    Sign in
                  </button>

                  {adminMessage && (
                    <div className="message">
                      {adminMessage}
                    </div>
                  )}

                </>

              ) : (

                <>

                  <h3>
                    Voter registrations
                  </h3>

                  {requests.length === 0 ? (

                    <p className="small">
                      No registrations yet.
                    </p>

                  ) : (

                    <div className="requests">

                      {requests.map((request) => (

                        <div
                          className="request"
                          key={request.id}
                        >

                          <div>
                            <strong>
                              #{request.id} · {request.status}
                            </strong>

                            <span>
                              {request.name}
                            </span>

                            <code>
                              {request.didHash}
                            </code>

                            <code>
                              confirmation wallet:{" "}
                              {request.confirmAddress}
                            </code>
                          </div>

                          {request.status === "pending" && (

                            <div className="request-actions">

                              <button
                                className="primary-button"
                                onClick={() =>
                                  decideRequest(
                                    request.id,
                                    "approve"
                                  )
                                }
                              >
                                Approve
                              </button>

                              <button
                                className="secondary-button"
                                onClick={() =>
                                  decideRequest(
                                    request.id,
                                    "reject"
                                  )
                                }
                              >
                                Reject
                              </button>

                            </div>

                          )}

                        </div>

                      ))}

                    </div>

                  )}

                  {adminMessage && (
                    <div className="message">
                      {adminMessage}
                    </div>
                  )}

                  <h3>
                    Create a new election
                  </h3>

                  <label>
                    Election name
                  </label>

                  <input
                    type="text"
                    value={newElectionName}
                    onChange={(event) =>
                      setNewElectionName(event.target.value)
                    }
                    placeholder="Board Election 2026"
                    autoComplete="off"
                  />

                  <label>
                    Options (one per line, at least two)
                  </label>

                  <textarea
                    rows={4}
                    value={newElectionOptions}
                    onChange={(event) =>
                      setNewElectionOptions(
                        event.target.value
                      )
                    }
                    placeholder={"Yes\nNo"}
                  />

                  <button
                    className="primary-button"
                    onClick={createElection}
                    disabled={loadingElection}
                  >
                    {loadingElection
                      ? "Creating..."
                      : "Create Election"}
                  </button>

                  <button
                    className="secondary-button"
                    onClick={adminLogout}
                  >
                    Sign out
                  </button>

                  {electionMessage && (
                    <div className="message">
                      {electionMessage}
                    </div>
                  )}

                </>

              )}

            </div>

            <div className="step-nav">

              <button
                className="secondary-button"
                onClick={() =>
                  setActiveTab("elections")
                }
              >
                ← Back to Elections
              </button>

            </div>

          </section>

        )}


        {/* ================= VOTE ================= */}

        {activeTab === "vote" && (

          <section className="card">

            <h2>
              Cast Your Vote
            </h2>

            {!identity ? (

              <>

                <div className="warning-box">
                  You need to create an identity
                  before voting.
                </div>

                <div className="step-nav">

                  <button
                    className="primary-button"
                    onClick={() =>
                      setActiveTab("identity")
                    }
                  >
                    ← Back to Identity
                  </button>

                </div>

              </>

            ) : selectedElection === null ? (

              <>

                <div className="warning-box">
                  You need to select an election
                  before voting.
                </div>

                <div className="step-nav">

                  <button
                    className="primary-button"
                    onClick={() =>
                      setActiveTab("elections")
                    }
                  >
                    ← Back to Elections
                  </button>

                </div>

              </>

            ) : (

              <>

                <div className="success-box">
                  Election:{" "}
                  <strong>
                    {elections.find(
                      (election) =>
                        election.id === selectedElection
                    )?.name || `#${selectedElection}`}
                  </strong>
                </div>

                <p>
                  Select one candidate. Your ballot is only
                  transmitted once you approve it in your
                  confirmation wallet
                  {identity.confirmAddress
                    ? ` (${identity.confirmAddress})`
                    : ""}
                  {" "}— check the candidate name the wallet
                  shows you before signing.
                </p>

                <div className="candidates">

                  {candidates.map((candidate) => (

                    <label
                      key={candidate.id}
                      className={
                        selectedCandidate === candidate.id
                          ? "candidate selected"
                          : "candidate"
                      }
                    >

                      <input
                        type="radio"
                        name="candidate"
                        value={candidate.id}
                        checked={
                          selectedCandidate ===
                          candidate.id
                        }
                        onChange={() =>
                          setSelectedCandidate(
                            candidate.id
                          )
                        }
                      />

                      <span>
                        {candidate.name}
                      </span>

                    </label>

                  ))}

                </div>

                <button
                  className="primary-button"
                  onClick={castVote}
                  disabled={
                    loadingVote ||
                    voteSubmitted ||
                    selectedCandidate === null
                  }
                >
                  {loadingVote
                    ? "Submitting..."
                    : "Cast Vote"}
                </button>

                {voteResult && (

                  <div className="vote-outcome">

                    <pre className="message">
                      {voteResult}
                    </pre>

                    {voteSubmitted && (
                      <img
                        className="vote-image"
                        src={CELEBRATION_IMAGE}
                        alt="Your vote is in"
                        onError={(event) => {
                          event.currentTarget.style.display =
                            "none";
                        }}
                      />
                    )}

                  </div>

                )}

                {voteSubmitted && (

                  <div className="step-nav">

                    <button
                      className="primary-button"
                      onClick={() =>
                        setActiveTab("results")
                      }
                    >
                      View Results →
                    </button>

                  </div>

                )}

              </>

            )}

          </section>

        )}


        {/* ================= RESULTS ================= */}

        {activeTab === "results" && (

          <section className="card">

            <div className="results-header">

              <div>
                <h2>
                  {selectedElection === null
                    ? "Election Results"
                    : elections.find(
                        (election) =>
                          election.id === selectedElection
                      )?.name || `Election #${selectedElection}`}
                </h2>

                <p>
                  {selectedElection === null
                    ? "Select an election on the Elections tab to see its results."
                    : "Results are read directly from the blockchain."}
                </p>
              </div>

              <button
                className="secondary-button"
                onClick={loadResults}
                disabled={loadingResults}
              >
                {loadingResults
                  ? "Loading..."
                  : "Refresh"}
              </button>

            </div>


            <div className="results">

              {results.map((result) => (

                <div
                  className="result-row"
                  key={result.name}
                >

                  <span>
                    {result.name}
                  </span>

                  <strong>
                    {result.votes}
                  </strong>

                </div>

              ))}

            </div>


            <h3>
              Blockchain Transactions
            </h3>

            <input
              type="text"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search tx hash or DID hash..."
            />


            <div className="vote-count">
              {votes.length} vote(s) recorded
            </div>


            <div className="transactions">

              {filteredVotes.length === 0 ? (

                <p className="small">
                  No matching transactions.
                </p>

              ) : (

                filteredVotes.map((vote) => (

                  <div
                    className="transaction"
                    key={vote.txHash}
                  >

                    <div>
                      <strong>
                        Transaction
                      </strong>

                      <code>
                        {vote.txHash}
                      </code>
                    </div>

                    <div>
                      <strong>
                        DID Hash
                      </strong>

                      <code>
                        {vote.didHash}
                      </code>
                    </div>

                    <div>
                      <strong>
                        Candidate
                      </strong>

                      <span>
                        #{vote.candidateId}
                      </span>
                    </div>

                    <div>
                      <strong>
                        Block
                      </strong>

                      <span>
                        {vote.blockNumber}
                      </span>
                    </div>

                  </div>

                ))

              )}

            </div>

          </section>

        )}

      </main>

    </div>
  );
}

export default App;
