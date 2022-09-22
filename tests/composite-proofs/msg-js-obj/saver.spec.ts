import { initializeWasm } from '@docknetwork/crypto-wasm';
import { checkResult, stringToBytes } from '../../utils';
import {
  BoundCheckSnarkSetup,
  CompositeProofG1, encodeRevealedMsgs,
  getAdaptedSignatureParamsForMessages,
  getIndicesForMsgNames,
  getRevealedAndUnrevealed,
  KeypairG2,
  MetaStatements,
  QuasiProofSpecG1,
  SaverChunkedCommitmentGens,
  SaverDecryptor,
  SaverEncryptionGens, SignatureG1,
  SignatureParamsG1,
  signMessageObject,
  Statement,
  Statements,
  verifyMessageObject,
  Witness,
  WitnessEqualityMetaStatement,
  Witnesses
} from '../../../src';
import { attributes1, attributes1Struct } from './data';
import { checkMapsEqual, GlobalEncoder } from './index';

describe('Verifiable encryption using SAVER', () => {
  beforeAll(async () => {
    // Load the WASM module
    await initializeWasm();
  });

  it('signing and proof of knowledge of signature, verifiable encryption and range proof', () => {
    // This test check in addition to proof of knowledge of signature, one of the attribute is verifiably encrypted for a
    // 3rd-party and a proof that an attribute satisfies bounds (range proof) can also be created.

    const label = stringToBytes('Sig params label - this is public');
    // Message count shouldn't matter as `label` is known
    let params = SignatureParamsG1.generate(1, label);
    const keypair = KeypairG2.generate(params);
    const sk = keypair.secretKey;
    const pk = keypair.publicKey;

    const signed = signMessageObject(attributes1, sk, label, GlobalEncoder);
    expect(verifyMessageObject(attributes1, signed.signature, pk, label, GlobalEncoder)).toBe(true);

    // Setup for decryptor
    const chunkBitSize = 16;
    const encGens = SaverEncryptionGens.generate();
    // `chunkBitSize` is optional, it will default to reasonable good value.
    const [saverSnarkPk, saverSk, encryptionKey, decryptionKey] = SaverDecryptor.setup(encGens, chunkBitSize);
    const saverEncGens = encGens.decompress();
    const saverProvingKey = saverSnarkPk.decompress();
    const saverVerifyingKey = saverSnarkPk.getVerifyingKeyUncompressed();
    const saverEk = encryptionKey.decompress();
    const saverDk = decryptionKey.decompress();

    console.info('Saver setup done');

    // Verifier creates SNARK proving and verification key
    const spk = BoundCheckSnarkSetup();
    const snarkProvingKey = spk.decompress();
    const snarkVerifyingKey = spk.getVerifyingKeyUncompressed();

    console.info('Bound check setup done');

    // The lower and upper bounds of attribute "timeOfBirth"
    const timeMin = 1662010819619;
    const timeMax = 1662011149654;

    // Verifier creates these parameters
    const gens = SaverChunkedCommitmentGens.generate(stringToBytes('some label'));
    const commGens = gens.decompress();

    // Reveal first name ("fname" attribute), last name ("lname") and country
    // Prove that "SSN" is verifiably encrypted
    // Prove that "timeOfBirth" satisfies the given bounds in zero knowledge, i.e. without revealing timeOfBirth

    const revealedNames = new Set<string>();
    revealedNames.add('fname');
    revealedNames.add('lname');
    revealedNames.add('country');

    // Both prover and verifier can independently create this struct
    const sigParams = getAdaptedSignatureParamsForMessages(params, attributes1Struct);

    const [revealedMsgs, unrevealedMsgs, revealedMsgsRaw] = getRevealedAndUnrevealed(
      attributes1,
      revealedNames,
      GlobalEncoder
    );
    expect(revealedMsgsRaw).toEqual({ fname: 'John', lname: 'Smith', country: 'USA' });

    const statement1 = Statement.bbsSignature(sigParams, pk, revealedMsgs, false);
    const statement2 = Statement.saverProver(saverEncGens, commGens, saverEk, saverProvingKey, chunkBitSize);
    const statement3 = Statement.boundCheckProver(timeMin, timeMax, snarkProvingKey);

    const statementsProver = new Statements();
    const sIdx1 = statementsProver.add(statement1);
    const sIdx2 = statementsProver.add(statement2);
    const sIdx3 = statementsProver.add(statement3);

    const witnessEq1 = new WitnessEqualityMetaStatement();
    witnessEq1.addWitnessRef(sIdx1, getIndicesForMsgNames(['SSN'], attributes1Struct)[0]);
    witnessEq1.addWitnessRef(sIdx2, 0);

    const witnessEq2 = new WitnessEqualityMetaStatement();
    witnessEq2.addWitnessRef(sIdx1, getIndicesForMsgNames(['timeOfBirth'], attributes1Struct)[0]);
    witnessEq2.addWitnessRef(sIdx3, 0);

    const metaStmtsProver = new MetaStatements();
    metaStmtsProver.addWitnessEquality(witnessEq1);
    metaStmtsProver.addWitnessEquality(witnessEq2);

    // The prover should independently construct this `ProofSpec`
    const proofSpecProver = new QuasiProofSpecG1(statementsProver, metaStmtsProver);

    const witness1 = Witness.bbsSignature(signed.signature, unrevealedMsgs, false);
    const witness2 = Witness.saver(signed.encodedMessages['SSN']);
    const witness3 = Witness.boundCheckLegoGroth16(signed.encodedMessages['timeOfBirth']);
    const witnesses = new Witnesses();
    witnesses.add(witness1);
    witnesses.add(witness2);
    witnesses.add(witness3);

    const proof = CompositeProofG1.generateUsingQuasiProofSpec(proofSpecProver, witnesses);

    // Verifier independently encodes revealed messages
    const revealedMsgsFromVerifier = encodeRevealedMsgs(revealedMsgsRaw, attributes1Struct, GlobalEncoder);
    checkMapsEqual(revealedMsgs, revealedMsgsFromVerifier);

    const statement4 = Statement.bbsSignature(sigParams, pk, revealedMsgsFromVerifier, false);
    const statement5 = Statement.saverVerifier(saverEncGens, commGens, saverEk, saverVerifyingKey, chunkBitSize);
    const statement6 = Statement.boundCheckVerifier(timeMin, timeMax, snarkVerifyingKey);

    const verifierStatements = new Statements();
    const sIdx4 = verifierStatements.add(statement4);
    const sIdx5 = verifierStatements.add(statement5);
    const sIdx6 = verifierStatements.add(statement6);

    const witnessEq3 = new WitnessEqualityMetaStatement();
    witnessEq3.addWitnessRef(sIdx4, getIndicesForMsgNames(['SSN'], attributes1Struct)[0]);
    witnessEq3.addWitnessRef(sIdx5, 0);

    const witnessEq4 = new WitnessEqualityMetaStatement();
    witnessEq4.addWitnessRef(sIdx4, getIndicesForMsgNames(['timeOfBirth'], attributes1Struct)[0]);
    witnessEq4.addWitnessRef(sIdx6, 0);

    const metaStmtsVerifier = new MetaStatements();
    metaStmtsVerifier.addWitnessEquality(witnessEq3);
    metaStmtsVerifier.addWitnessEquality(witnessEq4);

    const verifierProofSpec = new QuasiProofSpecG1(verifierStatements, metaStmtsVerifier);
    checkResult(proof.verifyUsingQuasiProofSpec(verifierProofSpec));

    // Verifier extracts the ciphertext
    const ciphertext = proof.getSaverCiphertext(sIdx5);

    // Decryptor gets the ciphertext from the verifier and decrypts it
    const decrypted = SaverDecryptor.decryptCiphertext(ciphertext, saverSk, saverDk, saverVerifyingKey, chunkBitSize);
    expect(decrypted.message).toEqual(signed.encodedMessages['SSN']);

    // Decryptor shares the decryption result with verifier which the verifier can check for correctness.
    expect(
      ciphertext.verifyDecryption(decrypted, saverDk, saverVerifyingKey, saverEncGens, chunkBitSize).verified
    ).toEqual(true);

    // Message can be successfully decoded to the original string
    const decoded = SignatureG1.reversibleDecodeStringMessageForSigning(signed.encodedMessages['SSN']);
    expect(decoded).toEqual(attributes1['SSN']);
  });
});