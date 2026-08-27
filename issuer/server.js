const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");

const app = express();

app.use(cors());
app.use(express.json());

const MNEMONIC =
  "test test test test test test test test test test test junk";

const ISSUER_PATH =
  "m/44'/60'/0'/0/1";

const CONTRACT_ADDRESS =
  "0x5FbDB2315678afecb367f032d93F642f64180aa3";

const issuerWallet =
  ethers.HDNodeWallet.fromPhrase(
    MNEMONIC,
    undefined,
    ISSUER_PATH
  );

/*
 * Demo admin secret.
 *
 * Shared with the frontend's admin view. Good enough to stop a
 * passer-by approving their own registration, but it is a plain
 * shared password in a demo — see the README.
 */
const ADMIN_PASSWORD = "123";


/*
 * Registration requests.
 *
 * A voter registers with a name; an administrator approves it;
 * only then is the credential signed. Lives in memory, so it
 * resets with the container.
 */
const requests = new Map();

let nextRequestId = 1;


function isAdmin(req) {
  return (
    req.header("x-admin-password") === ADMIN_PASSWORD
  );
}

function publicView(request) {
  return {
    id: request.id,
    name: request.name,
    didHash: request.didHash,
    confirmAddress: request.confirmAddress,
    status: request.status,
    requestedAt: request.requestedAt
  };
}


/*
 * Register as a voter. Creates a pending request.
 */
app.post("/api/requests", async (req, res) => {

  try {

    const { name, didHash, confirmAddress } =
      req.body;

    /*
     * Validate the voter's name.
     */
    if (
      !name ||
      typeof name !== "string" ||
      !name.trim()
    ) {
      return res.status(400).json({
        error: "Please provide your name"
      });
    }

    /*
     * Validate DID hash.
     */
    if (
      !didHash ||
      !ethers.isHexString(didHash, 32)
    ) {
      return res.status(400).json({
        error:
          "didHash must be a 32-byte hex string"
      });
    }

    /*
     * Validate the confirmation wallet.
     *
     * The credential names it, so this DID can only ever
     * be voted with the approval of this wallet.
     */
    if (
      !confirmAddress ||
      !ethers.isAddress(confirmAddress)
    ) {
      return res.status(400).json({
        error:
          "confirmAddress must be a valid wallet address"
      });
    }

    const request = {
      id: String(nextRequestId++),
      name: name.trim(),
      didHash,
      confirmAddress,
      status: "pending",
      credentialSig: null,
      requestedAt: new Date().toISOString()
    };

    requests.set(request.id, request);

    console.log(
      `Registration requested: ${request.name} (#${request.id})`
    );

    res.status(201).json(publicView(request));

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});


/*
 * Poll a request. Returns the credential once approved.
 */
app.get("/api/requests/:id", (req, res) => {

  const request = requests.get(req.params.id);

  if (!request) {
    return res.status(404).json({
      error: "Unknown registration request"
    });
  }

  res.json({
    ...publicView(request),
    credentialSig: request.credentialSig,
    issuer: issuerWallet.address,
    contractAddress: CONTRACT_ADDRESS
  });
});


/*
 * Admin: list every request.
 */
app.get("/api/admin/requests", (req, res) => {

  if (!isAdmin(req)) {
    return res.status(403).json({
      error: "Admin password required"
    });
  }

  res.json(
    [...requests.values()].map(publicView)
  );
});


/*
 * Admin: approve a request and issue the credential.
 */
app.post("/api/admin/requests/:id/approve", async (req, res) => {

  try {

    if (!isAdmin(req)) {
      return res.status(403).json({
        error: "Admin password required"
      });
    }

    const request = requests.get(req.params.id);

    if (!request) {
      return res.status(404).json({
        error: "Unknown registration request"
      });
    }

    if (request.status === "approved") {
      return res.json(publicView(request));
    }

    /*
     * Sign:

         keccak256(
           didHash,
           confirmAddress,
           contractAddress
         )

       This signature becomes the credential. It attests
       both that the DID is eligible and which wallet may
       approve its ballots.
    */
    const msgHash =
      ethers.keccak256(
        ethers.solidityPacked(
          ["bytes32", "address", "address"],
          [
            request.didHash,
            request.confirmAddress,
            CONTRACT_ADDRESS
          ]
        )
      );

    request.credentialSig =
      await issuerWallet.signMessage(
        ethers.getBytes(msgHash)
      );

    request.status = "approved";

    console.log(
      `Approved: ${request.name} (#${request.id})`
    );

    res.json(publicView(request));

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});


/*
 * Admin: reject a request.
 */
app.post("/api/admin/requests/:id/reject", (req, res) => {

  if (!isAdmin(req)) {
    return res.status(403).json({
      error: "Admin password required"
    });
  }

  const request = requests.get(req.params.id);

  if (!request) {
    return res.status(404).json({
      error: "Unknown registration request"
    });
  }

  if (request.status === "approved") {
    return res.status(409).json({
      error:
        "This request was already approved and its credential issued"
    });
  }

  request.status = "rejected";

  console.log(
    `Rejected: ${request.name} (#${request.id})`
  );

  res.json(publicView(request));
});


/*
 * Health check.
 */
app.get("/api/health", (req, res) => {

  res.json({
    ok: true,
    issuer: issuerWallet.address
  });

});


const PORT =
  process.env.PORT || 4000;

app.listen(PORT, () => {

  console.log(
    `Issuer service listening on port ${PORT}`
  );

  console.log(
    `Issuer address: ${issuerWallet.address}`
  );

  console.log(
    `Voters register with a name; an admin approves them in the app's Admin view.`
  );

});
