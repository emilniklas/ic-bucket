declare module "tweetnacl" {
  export default {
    sign: {
      keyPair: {
        fromSeed(seed: Uint8Array): {
          publicKey: Uint8Array;
          secretKey: Uint8Array;
        }
      }
    }
  }
}
