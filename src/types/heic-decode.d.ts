declare module "heic-decode" {
  interface DecodedHeic {
    width: number;
    height: number;
    /** RGBA pixels. */
    data: Uint8ClampedArray;
  }
  function decode(input: { buffer: Uint8Array }): Promise<DecodedHeic>;
  namespace decode {
    function all(input: {
      buffer: Uint8Array;
    }): Promise<
      { width: number; height: number; decode(): Promise<DecodedHeic> }[] & { dispose(): void }
    >;
  }
  export = decode;
}
