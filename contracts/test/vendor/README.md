# Coin contract test fixtures

Unmodified upstream fixtures downloaded from `kadena-io/chainweb-node`, branch `master`:

- `pact/coin-contract/coin.pact`
- `pact/coin-contract/v2/fungible-v2.pact`
- `pact/coin-contract/v4/fungible-xchain-v1.pact`

Source: https://github.com/kadena-io/chainweb-node/tree/master/pact/coin-contract

The escrow tests load the real coin implementation, including its managed TRANSFER capability and guard enforcement. These fixtures are used for tests, not deployed by the application. The upstream BSD license is preserved in `LICENSE`.
