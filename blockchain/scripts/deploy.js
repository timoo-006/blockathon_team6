const hre = require("hardhat");

// Hardhat's well-known local test mnemonic — deriving keys from it (rather
// than hardcoding raw hex) avoids typos and matches Hardhat's own default
// accounts exactly. Safe to use: this network only ever runs locally in
// Docker for demo purposes.
const MNEMONIC = "test test test test test test test test test test test junk";

// Account #0 is the deployer. Because it's a fresh chain and this is its very
// first transaction (nonce 0), the resulting contract address is always the
// same: 0x5FbDB2315678afecb367f032d93F642f64180aa3. That means the frontend
// and issuer service can hardcode it directly — no shared file, no metadata
// endpoint, no coordination service required.

async function main() {
  const candidates = ["Alice", "Bob", "Charlie"];
  const issuerWallet = hre.ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, "m/44'/60'/0'/0/1");

  const Voting = await hre.ethers.getContractFactory("Voting");
  const voting = await Voting.deploy(issuerWallet.address, candidates);
  await voting.waitForDeployment();

  const address = await voting.getAddress();
  console.log("Voting contract deployed at:", address);
  console.log("Issuer address:", issuerWallet.address);
  console.log("Candidates:", candidates.join(", "));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
