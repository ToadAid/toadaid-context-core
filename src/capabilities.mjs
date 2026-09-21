export function contextCoreCapabilities() {
  return Object.freeze({
    modelCalls: false,
    arbitraryCodeExecution: false,
    shellExecution: false,
    networkAccess: false,
    authorityGrants: false,
    durableMemoryWrites: false,
    walletAccess: false,
    tradeExecution: false,
    gitWrite: false,
  });
}
