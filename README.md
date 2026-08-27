# SSI Blockchain Voting (Ethereum + Docker Compose)

A minimal, decentralized e-voting dApp — no relay, no backend analytics.

- **Blockchain**: a `Voting.sol` smart contract on a local Hardhat (Ethereum)
  node. It holds any number of elections — each with a name and two or more
  options, opened from the app's separate admin view — verifies an SSI credential
  on-chain, and enforces one vote per identity *per election* via
  `hasVoted[electionId][didHash]`.
- **SSI**: your browser generates your own DID keypair
  (`did:ethr:0x...`) — the private key **never leaves the browser**. Only your
  name, the public DID hash, and the address of your confirmation wallet are
  sent to the **issuer**, as a *registration request*. Nothing is signed yet.
  An administrator reviews the request in the app's Admin view and approves or
  rejects it; on approval the issuer signs a Verifiable Credential attesting
  you're eligible (`keccak256(didHash, confirmAddress, contractAddress)`) and
  your browser picks it up on its next poll. Because the confirmation address
  is inside the signed credential, it can't be swapped for an attacker's
  wallet later. The issuer never touches the chain, never relays a
  transaction, and never sees your vote.
- **One identity per voter**: your keypair and credential are stored in your
  browser's `localStorage`, so refreshing the page reuses the *same*
  identity instead of generating a new one — the Vote page checks
  `hasVoted()` on load and disables voting if you've already cast a ballot.
  Getting a *second* identity means registering again under a name an
  administrator is willing to approve a second time — the approval step is
  what actually stops repeat voting, not the persistence itself.
- **Two-device confirmation**: the browser holds the key that *sends* the
  vote, but it cannot cast one alone. Every ballot also needs an EIP-712
  approval signature from a **separate confirmation wallet** (MetaMask or
  similar), which the issuer bound to your DID when it issued the credential.
  `Voting.sol` verifies that approval on-chain, so this is not a UI check the
  page could skip: a compromised voting device cannot vote for you, and cannot
  swap your candidate either — the approval is over the candidate's *name*,
  read from on-chain storage, so a swapped ballot produces a digest you never
  signed. The wallet displays that name in clear text before you sign.
- **No relay**: you sign and submit your own vote transaction, directly from
  the browser to the chain, with your own key. The local network is
  configured with `gasPrice: 0`, so a freshly generated, unfunded wallet can
  still transact — no faucet, no funding step, no third party submitting on
  your behalf.
- **No analytics backend**: the Results page queries the chain directly
  (`getResults(electionId)` and the `VoteCast` event log) from the browser. Anyone can
  independently run the same two calls against the contract address and get
  the same answer — there's no server in the loop to trust or that could
  misreport.

## Run it

```bash
docker compose up --build
```

Then open **http://localhost:8080**.

You need a browser wallet (e.g. MetaMask) installed — it acts as your
confirmation device. The app offers to add the local network (chainId
`31337`) to it on first use; you never need to fund the account, it only
signs approvals and never sends a transaction.

1. **Identity tab** — enter your name and click "Request Identity". Your
   wallet asks to connect: the account you pick becomes this identity's
   confirmation device, permanently. Your browser generates a voting keypair
   and registers it with the issuer, then sits on "waiting for approval",
   polling every few seconds. Open the **Admin view** in another tab or
   browser, sign in, and approve the request — the credential is signed at
   that moment and the Identity tab flips to approved on its own. Refreshing
   the page keeps both the pending request and the finished identity.
2. **Elections tab** — pick the election you want to vote in. The deployment
   opens with one ("General Election": Alice, Bob, Charlie).
3. **Vote tab** — pick a candidate and click "Cast Vote". Your wallet opens
   and shows the ballot as readable fields (`election: General Election`,
   `candidate: Bob`, `candidateId`, `didHash`). Check the election and
   candidate names, then sign. Nothing goes on-chain until you do, and the
   contract rejects any vote without that signature. After approval your
   browser signs and submits the transaction itself and you get the
   transaction hash immediately. If this identity already voted in this
   election, the button is disabled and it tells you so.
4. **Results tab** — tally for the selected election plus every included
   transaction hash, read straight from the chain. Paste your tx hash (or DID
   hash) into the search box to confirm your vote was counted.

**Admin view** — a separate tab, outside the numbered voter flow. Sign in
(demo password: `123`) and it holds two panels:

- **Voter registrations** — every request with its name, DID hash and
  confirmation wallet. Approve one and the issuer signs that voter's
  credential; reject it and the voter is told to register again. The list
  refreshes every few seconds, so approvals show up while you watch.
- **Create a new election** — give it a name and two or more options one per
  line. It goes on-chain immediately and appears in every voter's Elections
  tab; it does not touch whatever election the current voter has selected. The
  transaction is sent from a throwaway key, which works because the local
  chain runs at `gasPrice: 0`.

## Architecture

```
                 issuer (:4000) ── holds registrations, signs credentials
                    ▲                on admin approval, no chain access
                    │ POST /api/requests { name, didHash, confirmAddress }
                    │ POST /api/admin/requests/:id/approve  → credentialSig
                    │
frontend (:8080, browser) ─────────────► blockchain (:8545) — Voting.sol
        generates DID, signs & sends its own tx, reads results directly
       │
       │ EIP-712 Ballot(electionId, election, didHash, candidateId, candidate)
       ▼
  confirmation wallet (MetaMask) ── approves the ballot, never sends a tx
```

Three independent services — none of them depend on each other at startup.
`blockchain` deploys `Voting.sol` (opening with one demo election, "General
Election": Alice, Bob, Charlie) using a fixed local test key. Because it's always the first transaction from
that account on a fresh chain, the contract always ends up at the same
address (`0x5FbDB2315678afecb367f032d93F642f64180aa3`), so it can be
hardcoded in the frontend and issuer with no coordination step needed.

⚠️ This is a local demo: the deployer and issuer keys are Hardhat's
well-known default test accounts, hardcoded for simplicity. Do not reuse
this setup for a real election — a production issuer key should be held by
the actual credentialing authority (e.g. an election commission), ideally in
an HSM.

## Why there's still an issuer

SSI needs *someone* trusted to attest eligibility — that's what makes a
credential meaningful rather than self-asserted. Without an issuer, anyone
could mint themselves an unlimited number of "eligible voter" credentials.
The issuer here is intentionally the smallest possible trust anchor: it holds
a list of registration requests and signs one message per approved voter. The
judgement of *who* is eligible is a human one, made in the Admin view.

## Limits of this demo

- Registration requests live in the issuer's memory and reset on container
  restart — approved voters lose their credential and have to register again.
  A real deployment would back this with a database.
- **A name is not identity verification.** Anyone can register as anyone, and
  the same person can register twice under two names. The approval step only
  means an administrator recognised the name on screen; nothing ties it to a
  real person, and nothing stops a careless admin approving a duplicate. A
  real deployment would check the request against a voter roll and some form
  of real-world identity proof.
- **The admin password is a shared demo secret.** `123` is a constant in the
  frontend bundle, sent to the issuer as an `x-admin-password` header. The
  issuer does check it — so approvals aren't open to the world — but anyone
  who reads the JS bundle has it. And `createElection()` on the contract is
  unpermissioned regardless: anyone can call it directly with ethers or
  `cast`, no page involved. Making that one real means enforcing it on-chain
  (store an `admin` address in the constructor and
  `require(msg.sender == admin)`), so the check lives where the state changes
  rather than in the client that asks for it.
- **Every credential is valid in all elections.** The credential is bound to
  the contract rather than to one election — so one approval lets you vote
  once in *every* election that exists or is later created. A real deployment
  would issue credentials per election (put the election id in the signed
  credential), so eligibility is decided per ballot rather than once, globally.
- The voter's private key is stored in browser `localStorage`. That's fine
  for a local demo; a production system would use a proper wallet (browser
  extension, hardware key, or a mobile SSI wallet app) so the key is never
  touchable by page script.
- **The confirmation wallet is a browser extension on the same machine.** The
  on-chain enforcement is real, but the isolation is only as good as the
  extension boundary — malware with control of the whole machine could drive
  both. A real deployment would put the confirming key on genuinely separate
  hardware (a phone app or a hardware wallet), which is the same protocol with
  a different signer.
- **The confirmation address is public.** `vote()` takes it as an argument, so
  the transaction permanently links your ballot to that wallet address. If
  that address is used elsewhere, ballot secrecy is gone. Use a fresh account
  for voting, or bind the credential to a commitment and prove approval in
  zero knowledge — the naive version leaks.
- Losing access to the confirmation wallet makes the identity unusable: the
  binding is inside the issued credential, so recovery means registering again
  and being approved again.
- Clearing browser storage or using a different browser/device lets someone
  register a *new* identity — but it stays useless until an administrator
  approves it.
