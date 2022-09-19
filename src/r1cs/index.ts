import { Constraint, LC, LCTerm, R1CS } from '@docknetwork/crypto-wasm';

export interface ParsedR1CSFile {
  F: {fromMontgomery: (n: Uint8Array) => Uint8Array},
  curve: { name: string };
  n8: number;
  nPubInputs: number;
  nPrvInputs: number;
  nOutputs: number;
  nVars: number;
  constraints: [object, object, object];
}

export function processParsedR1CSFile(parsed: ParsedR1CSFile): R1CS {
  const curveName = parsed.curve.name as string;
  const numPublic = 1 + parsed.nPubInputs + parsed.nOutputs;
  const numPrivate = parsed.nVars - numPublic;

  function parseLC(i: string | number, v: Uint8Array): [number, Uint8Array] {
    // @ts-ignore
    return [parseInt(i), parsed.F.fromMontgomery(v)];
  }

  const constraints = parsed.constraints.map((c) => {
    // @ts-ignore
    const A: LC = Object.entries(c[0]).map(([i, v]) => parseLC(i, v) as LCTerm);
    // @ts-ignore
    const B: LC = Object.entries(c[1]).map(([i, v]) => parseLC(i, v) as LCTerm);
    // @ts-ignore
    const C: LC = Object.entries(c[2]).map(([i, v]) => parseLC(i, v) as LCTerm);
    return [A, B, C] as Constraint;
  });
  return {curveName, numPublic, numPrivate, constraints};
}

export function getR1CS(r1cs: R1CS | ParsedR1CSFile): R1CS {
  // @ts-ignore
  if (r1cs.F !== undefined) {
    return processParsedR1CSFile(r1cs as ParsedR1CSFile);
  }
  return r1cs as R1CS;
}

export * from './setup';
export * from './circom-inputs';
export * from './circom-circuit';
