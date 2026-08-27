#!/bin/bash
set -e

npx hardhat node --hostname 0.0.0.0 &
NODE_PID=$!

echo "Waiting for Hardhat node to be ready..."
until curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' > /dev/null 2>&1; do
  sleep 1
done

echo "Deploying Voting contract..."
npx hardhat run scripts/deploy.js --network localhost

echo "Blockchain ready. Keeping node alive..."
wait $NODE_PID
