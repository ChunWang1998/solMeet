import { AccountLayout, Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import BN = require("bn.js");
import {
  EscrowLayout,
  ESCROW_ACCOUNT_DATA_LAYOUT,
  getKeypair,
  getProgramId,
  getPublicKey,
  getTerms,
  getTokenBalance,
  logError,
  writePublicKey,
} from "./utils";

const alice = async () => {
  const escrowProgramId = getProgramId();
  const terms = getTerms();

  const aliceXTokenAccountPubkey = getPublicKey("alice_x");
  const aliceYTokenAccountPubkey = getPublicKey("alice_y");
  const XTokenMintPubkey = getPublicKey("mint_x");
  const aliceKeypair = getKeypair("alice");

  const tempXTokenAccountKeypair = new Keypair();
  const connection = new Connection("http://localhost:8899", "confirmed");
  const createTempTokenAccountIx = SystemProgram.createAccount({
    programId: TOKEN_PROGRAM_ID,
    space: AccountLayout.span,//can cal data size automatically which is serialized 
    lamports: await connection.getMinimumBalanceForRentExemption(
      AccountLayout.span
    ),
    fromPubkey: aliceKeypair.publicKey,
    newAccountPubkey: tempXTokenAccountKeypair.publicKey,
  });
  const initTempAccountIx = Token.createInitAccountInstruction(
    TOKEN_PROGRAM_ID,
    XTokenMintPubkey,
    tempXTokenAccountKeypair.publicKey,
    aliceKeypair.publicKey
  );
  //*---------------------------------------------------
  //transfer from aliceXTokenAccountPubkey to tempXTokenAccountKeypair
  //*---------------------------------------------------
  const transferXTokensToTempAccIx = Token.createTransferInstruction(
    TOKEN_PROGRAM_ID,
    aliceXTokenAccountPubkey,
    tempXTokenAccountKeypair.publicKey,
    aliceKeypair.publicKey,
    [],
    terms.bobExpectedAmount//5
  );
  const escrowKeypair = new Keypair();
  const createEscrowAccountIx = SystemProgram.createAccount({
    space: ESCROW_ACCOUNT_DATA_LAYOUT.span,//AccountLayout.span =>maybe size is not suitable
    lamports: await connection.getMinimumBalanceForRentExemption(
      ESCROW_ACCOUNT_DATA_LAYOUT.span
    ),
    fromPubkey: aliceKeypair.publicKey,
    newAccountPubkey: escrowKeypair.publicKey,
    programId: escrowProgramId,
  });
  const initEscrowIx = new TransactionInstruction({
    //refer: EscrowInstruction
    programId: escrowProgramId,
    keys: [
      { pubkey: aliceKeypair.publicKey, isSigner: true, isWritable: false },
      {
        pubkey: tempXTokenAccountKeypair.publicKey,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: aliceYTokenAccountPubkey,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: escrowKeypair.publicKey, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(
      Uint8Array.of(0, ...new BN(terms.aliceExpectedAmount).toArray("le", 8)) //correspond to amount in InitEscrow in lib.rs
    ),
  });

  const tx = new Transaction().add(
    createTempTokenAccountIx,
    initTempAccountIx,
    transferXTokensToTempAccIx,
    createEscrowAccountIx,
    initEscrowIx
  );
  console.log("Sending Alice's transaction...");
  await connection.sendTransaction(
    tx,
    //when the system program creates a new account, the tx needs to be signed by that account
    [aliceKeypair, tempXTokenAccountKeypair, escrowKeypair],
    { skipPreflight: false, preflightCommitment: "confirmed" }//skip deploy(simulate(run on local)) time 
  );

  // sleep to allow time to update
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const escrowAccount = await connection.getAccountInfo(
    escrowKeypair.publicKey
  );

  if (escrowAccount === null || escrowAccount.data.length === 0) {
    logError("Escrow state account has not been initialized properly");
    process.exit(1);
  }
  //1116
  const encodedEscrowState = escrowAccount.data;
  const decodedEscrowState = ESCROW_ACCOUNT_DATA_LAYOUT.decode(
    encodedEscrowState
  ) as EscrowLayout;

  if (!decodedEscrowState.isInitialized) {
    logError("Escrow state initialization flag has not been set");
    process.exit(1);
  } else if (
    !new PublicKey(decodedEscrowState.initializerPubkey).equals(
      aliceKeypair.publicKey
    )
  ) {
    logError(
      "InitializerPubkey has not been set correctly / not been set to Alice's public key"
    );
    process.exit(1);
  } else if (
    !new PublicKey(
      decodedEscrowState.initializerReceivingTokenAccountPubkey
    ).equals(aliceYTokenAccountPubkey)
  ) {
    logError(
      "initializerReceivingTokenAccountPubkey has not been set correctly / not been set to Alice's Y public key"
    );
    process.exit(1);
  } else if (
    !new PublicKey(decodedEscrowState.initializerTempTokenAccountPubkey).equals(
      tempXTokenAccountKeypair.publicKey
    )
  ) {
    logError(
      "initializerTempTokenAccountPubkey has not been set correctly / not been set to temp X token account public key"
    );
    process.exit(1);
  }
  console.log(
    `???Escrow successfully initialized. Alice is offering ${terms.bobExpectedAmount}X for ${terms.aliceExpectedAmount}Y???\n`
  );
  writePublicKey(escrowKeypair.publicKey, "escrow");
  console.table([
    {
      "Alice Token Account X": await getTokenBalance(
        aliceXTokenAccountPubkey,
        connection
      ),
      "Alice Token Account Y": await getTokenBalance(
        aliceYTokenAccountPubkey,
        connection
      ),
      "Bob Token Account X": await getTokenBalance(
        getPublicKey("bob_x"),
        connection
      ),
      "Bob Token Account Y": await getTokenBalance(
        getPublicKey("bob_y"),
        connection
      ),
      "Temporary Token Account X": await getTokenBalance(
        tempXTokenAccountKeypair.publicKey,
        connection
      ),
    },
  ]);

  console.log("");
};

alice();
