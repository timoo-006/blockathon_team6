require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: "0.8.19",
  networks: {
    // gasPrice: 0 means every transaction costs 0 ETH, so voters can sign and
    // submit their own vote transactions from a freshly generated, unfunded
    // wallet — no relayer / faucet needed.
    hardhat: {
      chainId: 31337,
      gasPrice: 0,
      initialBaseFeePerGas: 0
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      gasPrice: 0
    }
  }
};
