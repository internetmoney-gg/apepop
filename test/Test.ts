import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { MerkleTree } from "merkletreejs";

import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import hre from "hardhat";
import { ethers } from "hardhat";
import { TestToken, TestToken__factory } from "../typechain-types";

// Helper function to create commitment hash
function createCommitmentHash(position: bigint, wager: bigint, nonce: bigint): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["uint256", "uint256", "uint256"],
      [position, wager, nonce]
    )
  );
}

// Helper function to calculate winning threshold
async function calculateWinningThreshold(vpopContract: any, marketId: bigint): Promise<bigint> {
  const market = await vpopContract.markets(marketId);
  const marketConsensus = await vpopContract.marketConsensus(marketId);
  const consensus = marketConsensus.consensusPosition;
  
  // Calculate the range of possible positions
  const range = market.upperBound - market.lowerBound;
  
  // Calculate threshold based on winningPercentile (in basis points)
  // winningPercentile is in basis points (e.g., 2000 = 20%)
  const winningPercentile = BigInt(market.winningPercentile);

  const totalCommitments = marketConsensus.totalCommitments;

  // Create array to store distances
  const distances: bigint[] = [];
  
  // Loop through all commitments
  for (let i = 0; i < totalCommitments; i++) {
    const commitment = await vpopContract.commitments(marketId, i + 1);
    // Only process revealed commitments
    if (commitment.revealed) {
      const position = commitment.position;
      // Calculate absolute distance from consensus
      const distance = position > consensus ? 
        position - consensus : 
        consensus - position;
      
      distances.push(BigInt(distance));
    }
  }

  // Sort distances
  distances.sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  
  const winIndex = Math.floor(Number(distances.length) * Number(winningPercentile) / 10000)-1;

  if(distances.length == 1 || winIndex < 0){
    return distances[0];
  }
  
  return distances[winIndex];
}

// Helper function to create a market
async function createMarket({
  vpopContract,
  signer,
  token = ethers.ZeroAddress,
  lowerBound = 1n,
  upperBound = 100n,
  decimals = 1,
  minWager = ethers.parseEther("0.1"),
  decayFactor = 20,
  commitDuration = 3600,
  revealDuration = 3600,
  winningPercentile = 50,
  ipfsHash = "QmTest123"
}: {
  vpopContract: any,
  signer: any,
  token?: string,
  lowerBound?: bigint,
  upperBound?: bigint,
  decimals?: number,
  minWager?: bigint,
  decayFactor?: number,
  commitDuration?: number,
  revealDuration?: number,
  winningPercentile?: number,
  ipfsHash?: string
}): Promise<bigint> {
  const tx = await vpopContract.connect(signer).initializeMarket(
    token,
    lowerBound,
    upperBound,
    decimals,
    minWager,
    decayFactor,
    commitDuration,
    revealDuration,
    winningPercentile,
    ipfsHash
  );
  const receipt = await tx.wait();
  return await vpopContract.getMarketCount();
}

// Helper function to create a single commit
async function createCommit({
  vpopContract,
  marketId,
  signer,
  position,
  wager,
  nonce,
  proof = [],
  valueOverride
}: {
  vpopContract: any,
  marketId: bigint,
  signer: any,
  position: bigint,
  wager: bigint,
  nonce: bigint,
  proof?: string[],
  valueOverride?: any
}) {
  const commitmentHash = createCommitmentHash(position, proof.length == 0 ? wager : 100000n, nonce);
  const value = valueOverride !== undefined ? valueOverride : { value: wager };
  return vpopContract.connect(signer).commit(
    marketId,
    commitmentHash,
    wager,
    proof,
    value
  );
}

// === added helper =============================================
// Generates a nonce that fits into uint64 (required by the contract)
const randomNonce64 = (): bigint => {
  // 8 random bytes -> 64-bit unsigned integer
  return ethers.toBigInt(ethers.hexlify(ethers.randomBytes(8)));
};

describe("VPOP", function () {
  let vpop: any;
  let owner: any;
  let otherAccount: any;
  let thirdAccount: any;
  let testToken: TestToken;
  const apeAddress = "0x5AC40A1175715F1c27e3FEAa8C79664040717679";
  before(async function() {
    const [ownerSigner, otherAccountSigner, thirdAccountSigner] = await hre.ethers.getSigners();
    owner = ownerSigner;
    console.log('owner.address: ',owner.address);


    otherAccount = otherAccountSigner;
    thirdAccount = thirdAccountSigner;

    const VPOP = await hre.ethers.getContractFactory("VPOP");
    vpop = await VPOP.deploy();
  });

  it("Should deploy the contract", async function() {
    expect(vpop).to.not.be.undefined;
  });

  describe("Market Creation", function () {
    it("Should create a market with correct parameters", async function () {
      const marketId = await createMarket({
        vpopContract: vpop,
        signer: owner,
        token: ethers.ZeroAddress,
        lowerBound: ethers.parseEther("1"),
        upperBound: ethers.parseEther("10"),
        decimals: 18,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 20,
        commitDuration: 3600,
        revealDuration: 3600,
        winningPercentile: 50,
        ipfsHash: "QmTest123"
      });
      
      // Verify the market was created correctly
      const market = await vpop.markets(1n); // Use BigInt for market ID
      expect(market.creator).to.equal(owner.address);
      expect(market.token).to.equal(ethers.ZeroAddress);
      expect(market.lowerBound).to.equal(ethers.parseEther("1"));
      expect(market.upperBound).to.equal(ethers.parseEther("10"));
      expect(market.decimals).to.equal(18);
      expect(market.minWager).to.equal(ethers.parseEther("0.1"));
      expect(market.decayFactor).to.equal(20);
      expect(market.commitDuration).to.equal(3600);
      expect(market.revealDuration).to.equal(3600);
      expect(market.winningPercentile).to.equal(50);
      expect(market.ipfsHash).to.equal("QmTest123");
    });

    it("Should fail when creating a market with invalid parameters", async function () {
      await expect(
        createMarket({
          vpopContract: vpop,
          signer: owner,
          lowerBound: 10000n,
          upperBound: 1000n,
          decimals: 19,
          minWager: 0n,
          decayFactor: 0,
          commitDuration: 0,
          revealDuration: 0,
          winningPercentile: 101,
          ipfsHash: ""
        })
      ).to.be.revertedWith("Lower bound must be less than upper bound");
    });

    it("Should increment market counter correctly", async function () {
      // Create first market
      await createMarket({
        vpopContract: vpop,
        signer: owner,
        lowerBound: 1000n,
        upperBound: 10000n,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 10,
        ipfsHash: "QmTest1"
      });

      // Create second market
      await createMarket({
        vpopContract: vpop,
        signer: owner,
        lowerBound: 1000n,
        upperBound: 10000n,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 10,
        ipfsHash: "QmTest2"
      });
      const marketCount = await vpop.getMarketCount();
      // Check market count
      expect(marketCount).to.equal(3); // Starting from 1
    });
  });

  describe("Commitments", function () {
    it("Should create a commitment with correct parameters", async function () {
      const ownerBalance = await ethers.provider.getBalance(owner.address);
      
      // Create a market first
      const marketId = await createMarket({
        vpopContract: vpop,
        signer: owner,
        lowerBound: 1000n,
        upperBound: 10000n,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 20,
        ipfsHash: "QmTest123"
      });

      // Create commitment parameters
      const position = 5000n; // 50%
      const nonce = randomNonce64();
      const wager = ethers.parseEther("0.5");

      // Calculate the commitment hash
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment
      const tx = await createCommit({
        vpopContract: vpop,
        marketId: marketId,
        signer: owner,
        position,
        wager,
        nonce
      });
      const receipt = await tx.wait();
      const event = receipt?.logs[0];

      const marketConsensus = await vpop.marketConsensus(marketId);
      const commitmentId = marketConsensus.totalCommitments;
      
      // Verify commitment was created
      const commitment = await vpop.commitments(marketId, commitmentId);
      expect(commitment.commitmentHash).to.equal(commitmentHash);
      expect(commitment.wager).to.equal(wager);
      expect(commitment.position).to.equal(0); // Position should be 0 until revealed
      expect(commitment.nonce).to.equal(0); // Nonce should be 0 until revealed
      expect(commitment.revealed).to.be.false;
    });

    it("Should fail when creating commitment for non-existent market", async function () {
      const position = 5000n;
      const nonce = randomNonce64();
      const wager = ethers.parseEther("0.01");
      const marketCount = await vpop.getMarketCount();
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      await expect(
        vpop.commit(marketCount + 1n, commitmentHash, wager, [], { value: wager })
      ).to.be.revertedWith("Market does not exist");
    });

    it("Should fail when wager is below minimum", async function () {
      // Create a market with minWager of 0.1 ETH
      const marketId = await createMarket({
        vpopContract: vpop,
        signer: owner,
        lowerBound: 1000n,
        upperBound: 10000n,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 20,
        ipfsHash: "QmTest123"
      });

      const position = 5000n;
      const nonce = randomNonce64();
      const wager = ethers.parseEther("0.05"); // Below minimum wager
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      await expect(
        vpop.commit(marketId, commitmentHash, wager, [], { value: wager })
      ).to.be.revertedWith("Wager below minimum wager");
    });

    it("Should fail when commitment phase has ended", async function () {
      // Create a market with 1 hour commit duration
      const marketId = await createMarket({
        vpopContract: vpop,
        signer: owner,
        lowerBound: ethers.parseEther("1"),
        upperBound: ethers.parseEther("10"),
        minWager: ethers.parseEther("0.1"),
        decayFactor: 20,
        commitDuration: 3600, // 1 hour
        ipfsHash: "QmTest123"
      });

      const position = 5000n;
      const nonce = randomNonce64();
      const wager = ethers.parseEther("0.5");
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Advance time by 2 hours
      await time.increase(7200);

      await expect(
        vpop.commit(marketId, commitmentHash, wager, [], { value: wager })
      ).to.be.revertedWith("Commitment phase has ended");
    });

    it("Should create multiple commitments", async function () {
      // Create a market with a longer commit duration (2 hours)
      const marketId = await createMarket({
        vpopContract: vpop,
        signer: owner,
        lowerBound: ethers.parseEther("1"),
        upperBound: ethers.parseEther("10"),
        minWager: ethers.parseEther("0.1"),
        decayFactor: 20,
        commitDuration: 7200, // 2 hours commit duration
        ipfsHash: "QmTest123"
      });
      
      // Create commitment parameters
      const position1 = 5000n;
      const position2 = 6000n;
      const nonce1 = randomNonce64();
      const nonce2 = randomNonce64();
      const wager = ethers.parseEther("0.5");

      // Calculate commitment hashes
      const commitmentHash1 = createCommitmentHash(position1, wager, nonce1);
      const commitmentHash2 = createCommitmentHash(position2, wager, nonce2);

      // Get the market to check timing
      const market = await vpop.markets(marketId);
      const commitEndTime = market.createdAt + market.commitDuration;
      const currentTime = await time.latest();
      
      // Verify we're still in the commit phase
      expect(currentTime).to.be.lessThan(commitEndTime);

      // Create two commitments
      const tx1 = await createCommit({
        vpopContract: vpop,
        marketId: marketId,
        signer: owner,
        position: position1,
        wager,
        nonce: nonce1
      });
      const receipt1 = await tx1.wait();
      const event1 = receipt1?.logs[0];

      const tx2 = await createCommit({
        vpopContract: vpop,
        marketId: marketId,
        signer: owner,
        position: position2,
        wager,
        nonce: nonce2
      });
      const receipt2 = await tx2.wait();
      const event2 = receipt2?.logs[0];

      // Verify commitments exist
      const commitment1 = await vpop.commitments(marketId, 1);
      const commitment2 = await vpop.commitments(marketId, 2);
      expect(commitment1.commitmentHash).to.equal(commitmentHash1);
      expect(commitment2.commitmentHash).to.equal(commitmentHash2);
      expect(commitment1.position).to.equal(0); // Position should be 0 until revealed
      expect(commitment2.position).to.equal(0); // Position should be 0 until revealed
    });

  });

  describe("Fee Management", function () {
    it("Should have correct initial fee rates", async function () {
      const platformFeeRate = await vpop.platformFeeRate();
      const creatorFeeRate = await vpop.creatorFeeRate();
      const apeFeeRate = await vpop.apeFeeRate();
      const apeOwner = await vpop.apeOwner();

      expect(platformFeeRate).to.equal(800); // 8%
      expect(creatorFeeRate).to.equal(200); // 2%
      expect(apeFeeRate).to.equal(200); // 2%
      expect(apeOwner).to.equal(apeAddress); // Initial ape owner should be zero address
    });

    it("Should allow owner to update fee rates", async function () {
      const newPlatformFeeRate = 1000; // 10%
      const newCreatorFeeRate = 300; // 3%
      const newApeFeeRate = 300; // 3%
      const newMarketCreateFee = 0; // 0 ETH market creation fee
      const newAllowPublicMarkets = true;
      await vpop.updatePlatformSettings(
        newPlatformFeeRate,
        newCreatorFeeRate,
        newApeFeeRate,
        newMarketCreateFee,
        newAllowPublicMarkets
      );

      const platformFeeRate = await vpop.platformFeeRate();
      const creatorFeeRate = await vpop.creatorFeeRate();
      const apeFeeRate = await vpop.apeFeeRate();

      expect(platformFeeRate).to.equal(newPlatformFeeRate);
      expect(creatorFeeRate).to.equal(newCreatorFeeRate);
      expect(apeFeeRate).to.equal(newApeFeeRate);
    });

    it("Should not allow non-owner to update fee rates", async function () {
      const newPlatformFeeRate = 1000;
      const newCreatorFeeRate = 300;
      const newApeFeeRate = 300;
      const newMarketCreateFee = 0; // 0 ETH market creation fee
      const newAllowPublicMarkets = true;
      await expect(
        vpop.connect(otherAccount).updatePlatformSettings(
          newPlatformFeeRate,
          newCreatorFeeRate,
          newApeFeeRate,  
          newMarketCreateFee,
          newAllowPublicMarkets
        )
      ).to.be.revertedWithCustomError(vpop, "OwnableUnauthorizedAccount");
    });

    it("Should distribute fees correctly including ape fee", async function () {
      // Create a market
      const marketId = await createMarket({
        vpopContract: vpop,
        signer: otherAccount,
        lowerBound: 1000n,
        upperBound: 10000n,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 20,
        ipfsHash: "QmTest123"
      });

      const market = await vpop.markets(marketId);
      const marketCreator = market.creator;
      expect(marketCreator).to.equal(otherAccount.address);

      // Create commitment parameters
      const position = 5000n;
      const nonce = randomNonce64();
      const wager = ethers.parseEther("1.0"); // 1 ETH wager
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Get initial balances
      const initialOwnerBalance = await ethers.provider.getBalance(owner.address);
      const initialCreatorBalance = await ethers.provider.getBalance(marketCreator);
      const initialApeOwnerBalance = await ethers.provider.getBalance(apeAddress);

      // Create commitment
      const tx = await createCommit({
        vpopContract: vpop,
        marketId: marketId,
        signer: thirdAccount,
        position,
        wager,
        nonce
      });
      const receipt = await tx.wait();

      // Calculate expected fees
      const platformFee = (wager * 1000n) / 10000n; // 10%
      const creatorFee = (wager * 300n) / 10000n; // 3%
      const apeFee = (wager * 300n) / 10000n; // 3%

      // Get final balances
      const finalOwnerBalance = await ethers.provider.getBalance(owner.address);
      const finalCreatorBalance = await ethers.provider.getBalance(marketCreator);
      const finalApeOwnerBalance = await ethers.provider.getBalance(apeAddress);

      // Verify fee distribution
      expect(finalOwnerBalance - initialOwnerBalance).to.equal(platformFee);
      expect(finalCreatorBalance - initialCreatorBalance).to.equal(creatorFee);
      expect(finalApeOwnerBalance - initialApeOwnerBalance).to.equal(apeFee);
    });

    it("Should distribute ERC20 fees correctly including ape fee", async function () {
      // Deploy a test ERC20 token
      const TestToken = await ethers.getContractFactory("TestToken");
      testToken = await TestToken.deploy();
      await testToken.waitForDeployment();

      // Mint tokens to the test account
      const wager = ethers.parseEther("1.0"); // 1 token
      await testToken.mint(thirdAccount.address, wager * 2n); // Mint extra for fees
      await testToken.connect(thirdAccount).approve(await vpop.getAddress(), wager * 2n);

      // Create a market with the test token
      const marketId = await createMarket({
        vpopContract: vpop,
        signer: otherAccount,
        token: await testToken.getAddress(),
        lowerBound: ethers.parseEther("1"),
        upperBound: ethers.parseEther("10"),
        minWager: ethers.parseEther("0.1"),
        decayFactor: 20,
        ipfsHash: "QmTest123"
      });

      const market = await vpop.markets(marketId);
      const marketCreator = market.creator;
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = randomNonce64();
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Get initial balances
      const initialOwnerBalance = await testToken.balanceOf(owner.address);
      const initialCreatorBalance = await testToken.balanceOf(marketCreator);
      const initialApeOwnerBalance = await testToken.balanceOf(apeAddress);

      // Create commitment
      const tx = await createCommit({
        vpopContract: vpop,
        marketId: marketId,
        signer: thirdAccount,
        position,
        wager,
        nonce
      });
      const receipt = await tx.wait();

      // Calculate expected fees
      const platformFee = (wager * 1000n) / 10000n; // 10%
      const creatorFee = (wager * 300n) / 10000n; // 3%
      const apeFee = (wager * 300n) / 10000n; // 3%

      // Get final balances
      const finalOwnerBalance = await testToken.balanceOf(owner.address);
      const finalCreatorBalance = await testToken.balanceOf(marketCreator);
      const finalApeOwnerBalance = await testToken.balanceOf(apeAddress);

      // Verify fee distribution
      expect(finalOwnerBalance - initialOwnerBalance).to.equal(platformFee);
      expect(finalCreatorBalance - initialCreatorBalance).to.equal(creatorFee);
      expect(finalApeOwnerBalance - initialApeOwnerBalance).to.equal(apeFee);
    });
  });

  describe("Reveal Phase", function () {
    it("Should successfully reveal a valid commitment", async function () {
      // Create a market
      const marketId = await createMarket({
        vpopContract: vpop,
        signer: owner,
        lowerBound: 1000n,
        upperBound: 10000n,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 20,
        ipfsHash: "QmTest123"
      });
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = randomNonce64();
      const wager = ethers.parseEther("0.5");

      // Calculate the commitment hash
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment
      const tx = await createCommit({
        vpopContract: vpop,
        marketId: marketId,
        signer: owner,
        position,
        wager,
        nonce
      });
      const receipt = await tx.wait();

      // Verify the commitment is marked as revealed
      const commitment1 = await vpop.commitments(marketId, 1);
      expect(commitment1.revealed).to.be.false;

      // Move to reveal phase
      await time.increase(3601);

      // Reveal commitment
      await vpop.reveal(marketId, 1, commitmentHash, position, nonce);

      // Verify the commitment is marked as revealed
      const commitment2 = await vpop.commitments(marketId, 1);
      expect(commitment2.revealed).to.be.true;
    });

    it("Should fail when revealing during commit phase", async function () {
      // Create a market
      const marketId = await createMarket({
        vpopContract: vpop,
        signer: owner,
        lowerBound: 1000n,
        upperBound: 10000n,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 20,
        ipfsHash: "QmTest123"
      });
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = randomNonce64();
      const wager = ethers.parseEther("0.5");

      // Calculate the commitment hash
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment
      const tx = await createCommit({
        vpopContract: vpop,
        marketId: marketId,
        signer: owner,
        position,
        wager,
        nonce
      });

      // Try to reveal during commit phase
      await expect(
        vpop.reveal(marketId, 1, commitmentHash, position, nonce)
      ).to.be.revertedWith("Not in reveal phase");
    });

    it("Should fail when revealing after before or after reveal phase", async function () {
      // Create a market
      const marketId = await createMarket({
        vpopContract: vpop,
        signer: owner,
        lowerBound: 1000n,
        upperBound: 10000n,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 20,
        ipfsHash: "QmTest123"
      });
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = randomNonce64();
      const wager = ethers.parseEther("0.5");

      // Calculate the commitment hash
      const commitmentHash1 = createCommitmentHash(position, wager, nonce);
      const commitmentHash2 = createCommitmentHash(position, wager, nonce);

      // Create commitment
      const tx1 = await createCommit({
        vpopContract: vpop,
        marketId: marketId,
        signer: owner,
        position,
        wager,
        nonce
      });
      const receipt1 = await tx1.wait();
      const event1 = receipt1?.logs[0];

      const tx2 = await createCommit({
        vpopContract: vpop,
        marketId: marketId,
        signer: owner,
        position,
        wager,
        nonce
      });
      const receipt2 = await tx2.wait();
      const event2 = receipt2?.logs[0];

      await time.increase(3600 + 1);
      // Try to reveal before reveal phase ends (should fail)
      await vpop.reveal(marketId, 2, commitmentHash2, position, nonce);
      
      // Advance time past both commit and reveal phases
      await time.increase(7200 + 1);

      // Try to reveal after reveal phase
      await expect(
        vpop.reveal(marketId, 1, commitmentHash1, position, nonce)
      ).to.be.revertedWith("Not in reveal phase");
    });

    it("Should fail when revealing with incorrect data", async function () {
      // Create a market
      const marketId = await createMarket({
        vpopContract: vpop,
        signer: owner,
        lowerBound: 1000n,
        upperBound: 10000n,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 20,
        ipfsHash: "QmTest123"
      });
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = randomNonce64();
      const wager = ethers.parseEther("0.5");

      // Calculate the commitment hash
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment
      const tx = await createCommit({
        vpopContract: vpop,
        marketId: marketId,
        signer: owner,
        position,
        wager,
        nonce
      });

      // Advance time to reveal phase
      await time.increase(3600 + 1);

      // Try to reveal with incorrect data
      const incorrectPosition = 6000n;
      await expect(
        vpop.reveal(marketId, 1, commitmentHash, incorrectPosition, nonce)
      ).to.be.revertedWith("Revealed data does not match commitment hash");
    });

    it("Should fail when revealing the same commitment twice", async function () {
      // Create a market
      const marketId = await createMarket({
        vpopContract: vpop,
        signer: owner,
        lowerBound: 1000n,
        upperBound: 10000n,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 0,
        ipfsHash: "QmTest123"
      });
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = randomNonce64();
      const wager = ethers.parseEther("0.5");

      // Calculate the commitment hash
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment
      const tx = await createCommit({
        vpopContract: vpop,
        marketId: marketId,
        signer: owner,
        position,
        wager,
        nonce
      });

      // Advance time to reveal phase
      await time.increase(3600 + 1);

      // Reveal the commitment
      await vpop.reveal(marketId, 1, commitmentHash, position, nonce);

      // Try to reveal the same commitment again
      await expect(
        vpop.reveal(marketId, 1, commitmentHash, position, nonce)
      ).to.be.revertedWith("Commitment already revealed");
    });
  });

  describe("Market Resolve", function () {
    it("should handle incorrect winning threshold proposals", async function () {
      // Create a market
      const marketId = await createMarket({
        vpopContract: vpop,
        signer: owner,
        lowerBound: 0n,
        upperBound: 1000n,
        decimals: 1,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 0,
        commitDuration: 3600,
        revealDuration: 3600,
        winningPercentile: 8000, // 80% winningPercentile
        ipfsHash: "ipfs://threshold-test"
      });

      // Create commitments with different positions
      const positions = [100n, 200n, 300n, 400n];
      const wagers = [
        ethers.parseEther("1"),
        ethers.parseEther("1"),
        ethers.parseEther("1"),
        ethers.parseEther("1")
      ];
      const nonces = positions.map(() => randomNonce64());
      const commitmentHashes = positions.map((pos, i) => createCommitmentHash(pos, wagers[i], nonces[i]));

      // Submit all commitments
      for (let i = 0; i < 4; i++) {
        await vpop.connect([owner, otherAccount, thirdAccount, owner][i])
          .commit(marketId, commitmentHashes[i], wagers[i], [], { value: wagers[i] });
      }

      // Move to reveal phase
      await time.increase(3601);

      // Reveal all commitments
      for (let i = 0; i < 4; i++) {
        await vpop.connect([owner, otherAccount, thirdAccount, owner][i])
          .reveal(marketId, i+1, commitmentHashes[i], positions[i], nonces[i]);
      }

      // Move to resolution phase
      await time.increase(3601);

      // Calculate the true winning threshold
      const trueThreshold = await calculateWinningThreshold(vpop, marketId);
      
      // Try to resolve with a threshold that's too high
      const tooHighThreshold = trueThreshold + 2n;
      await expect(vpop.resolve(marketId, tooHighThreshold))
        .to.be.revertedWith("PWT too high or non-existent rank");

      // Try to resolve with a threshold that's too low
      const tooLowThreshold = trueThreshold - 2n;
      await expect(vpop.resolve(marketId, tooLowThreshold))
        .to.be.revertedWith("PWT too low or non-existent rank");

      // Resolve with the correct threshold
      await vpop.resolve(marketId, trueThreshold);

      // Verify market is resolved
      const marketConsensus = await vpop.marketConsensus(marketId);
      expect(marketConsensus.resolved).to.be.true;
      expect(marketConsensus.winningThreshold).to.equal(trueThreshold);

      // Try to resolve again with the correct threshold
      await expect(vpop.resolve(marketId, trueThreshold))
        .to.be.revertedWith("Market already resolved");
    });
    
    it("should resolve only after reveal phase or all revealed, and set consensus and winning threshold", async function () {
      // Use existing signers
      const signers = [owner, otherAccount, thirdAccount];

      // Create a market
      const marketId = await createMarket({
        vpopContract: vpop,
        signer: owner,
        lowerBound: 0n,
        upperBound: 1000n,
        decimals: 1,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 0,
        commitDuration: 3600, // 1 hour commit
        revealDuration: 3600, // 1 hour reveal
        winningPercentile: 8000, // 80% winningPercentile
        ipfsHash: "ipfs://resolve-test"
      });

      // Commitments
      const positions = [
        120n,
        150n,
        180n
      ];
      const wagers = [
        ethers.parseEther("1"),
        ethers.parseEther("1"),
        ethers.parseEther("1")
      ];
      const nonces = positions.map(() => randomNonce64());
      const commitmentHashes = positions.map((pos, i) => createCommitmentHash(pos, wagers[i], nonces[i]));

      // Move to reveal phase
      await time.increase(3000);

      // Submit commitments
      for (let i = 0; i < 3; i++) {
        const tx = await createCommit({
          vpopContract: vpop,
          marketId: marketId,
          signer: signers[i],
          position: positions[i],
          wager: wagers[i],
          nonce: nonces[i]
        });
        const receipt = await tx.wait();
        const event = receipt?.logs[0];
      }

      // Move to reveal phase
      await time.increase(700);

      // Reveal 
      for (let i = 0; i < 3; i++) {
        const tx = await vpop.reveal(
          marketId,
          i+1,
          commitmentHashes[i],
          positions[i],
          nonces[i]
        );
        const receipt = await tx.wait();
        const event = receipt?.logs[0];
      }

      // Move to after reveal phase
      await time.increase(3601);

      // Calculate winning threshold
      const threshold1 = await calculateWinningThreshold(vpop, marketId);
      // Now resolve should succeed
      await vpop.resolve(marketId, threshold1);
      const marketConsensus = await vpop.marketConsensus(marketId);
      const consensus = marketConsensus.consensusPosition;
      expect(marketConsensus.resolved).to.be.true;
      expect(consensus).to.be.gt(0);
      expect(marketConsensus.winningThreshold).to.be.gte(0);

      // The consensus should be the weighted average of revealed positions
      const totalWeight = wagers[0] + wagers[1] + wagers[2];
      const weightedSum = positions[0] * wagers[0] + positions[1] * wagers[1] + positions[2] * wagers[2];
      const expectedConsensus = weightedSum / totalWeight;
      expect(consensus).to.equal(expectedConsensus);
      // Verify winning positions can claim and losers cannot
      const totalWinnings = marketConsensus.totalWinnings;
      const totalWinningWagers = wagers[0] + wagers[1]; // Only first two positions are revealed
      
      // Check balances before claiming
      const balancesBefore = await Promise.all(
        signers.map(signer => ethers.provider.getBalance(signer.address))
      );

      // Try to claim for each position
      for (let i = 0; i < 3; i++) {
        const distance = positions[i] > consensus ? positions[i] - consensus : consensus - positions[i];
        const isWinning = distance <= threshold1;
        if (isWinning) {
          // Should succeed for winning positions
          await expect(vpop.connect(signers[i])
            .claim(marketId, i+1))
            .to.not.be.reverted;
        } else {
          // Should fail for non-winning positions
          await expect(vpop.connect(signers[i])
            .claim(marketId, i+1))
            .to.be.revertedWith("Not a winning position");
        }
      }

      // Check balances after claiming
      const balancesAfter = await Promise.all(
        signers.map(signer => ethers.provider.getBalance(signer.address))
      );

      // Verify balance changes
      for (let i = 0; i < 2; i++) { // Only check first two positions (revealed)
        const distance = positions[i] > consensus ? positions[i] - consensus : consensus - positions[i];
        const isWinning = distance <= threshold1;
        
        if (isWinning) {
          const expectedWinnings = (wagers[i] * totalWinnings) / totalWinningWagers;
          const balanceChange = balancesAfter[i] - balancesBefore[i];
          expect(balanceChange).to.be.gt(0); // Should have received winnings
        }
      }

      // Try to resolve again - should fail
      await expect(vpop.resolve(marketId, threshold1)).to.be.revertedWith("Market already resolved");
      // The third (unrevealed) commitment should not affect consensus or threshold
      // Only revealed commitments are considered
    });

    it("should have all positions as winners when winningPercentile is 100", async function () {
      // Create a market with 100% winningPercentile and zero decay
      const marketId = await createMarket({
        vpopContract: vpop,
        signer: owner,
        lowerBound: 0n,
        upperBound: 10n,
        decimals: 0,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 0, // zero decay factor
        commitDuration: 3600,
        revealDuration: 3600,
        winningPercentile: 100, // 100% winningPercentile
        ipfsHash: "ipfs://all-winners-test"
      });

      // Create 4 commitments: two at position 1, two at position 3
      const positions = [1n, 1n, 3n, 3n];
      const wagers = [
        ethers.parseEther("1"),
        ethers.parseEther("1"),
        ethers.parseEther("1"),
        ethers.parseEther("1")
      ];
      const nonces = positions.map(() => randomNonce64());
      const commitmentHashes = positions.map((pos, i) => createCommitmentHash(pos, wagers[i], nonces[i]));

      // Submit all commitments
      for (let i = 0; i < 4; i++) {
        await vpop.connect([owner, otherAccount, thirdAccount, owner][i])
          .commit(marketId, commitmentHashes[i], wagers[i], [], { value: wagers[i] });
      }

      // Move to reveal phase
      await time.increase(3601);

      // Reveal all commitments
      for (let i = 0; i < 4; i++) {
        await vpop.connect([owner, otherAccount, thirdAccount, owner][i])
          .reveal(marketId, i+1, commitmentHashes[i], positions[i], nonces[i]);
      }

      // Move to resolution phase
      await time.increase(3601);

      // Calculate winning threshold
      const threshold = await calculateWinningThreshold(vpop, marketId);

      // Resolve market
      await vpop.resolve(marketId, threshold);

      // Verify consensus is 2 (average of 1 and 3)
      const marketConsensus = await vpop.marketConsensus(marketId);      
      expect(marketConsensus.consensusPosition).to.equal(2n);

      // Verify all positions can claim winnings and check balance changes
      const totalWagers = wagers.reduce((sum, wager) => sum + wager, 0n);
      const feePercentage = 1600n; // 16% in basis points
      const totalFees = (totalWagers * feePercentage) / 10000n;
      const totalWinnings = totalWagers - totalFees;
      const expectedWinningsPerWinner = totalWinnings / 4n; // 4 winners
      
      for (let i = 0; i < 4; i++) {
        const account = [owner, otherAccount, thirdAccount, owner][i];
        const balanceBefore = await ethers.provider.getBalance(account.address);
                
        const tx = await vpop.connect(account).claim(marketId, i+1);
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed;
        const gasPrice = receipt.gasPrice;
        const gasCost = BigInt(gasUsed) * BigInt(gasPrice);
        const balanceAfter = await ethers.provider.getBalance(account.address);
        const actualReceived = balanceAfter - balanceBefore + gasCost;
        expect(actualReceived).to.equal(expectedWinningsPerWinner);
      }
    });
  });

  describe("Claim Winnings", function () {
    it("should calculate correct winning threshold and allow only winning positions to claim", async function () {
      // Create a market with 20% winningPercentile
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        1000,
        2000,
        0,
        ethers.parseEther("0.1"),
        1,
        3600,
        3600,
        2000, // 20% winningPercentile
        "ipfs://threshold-test"
      );
      const marketId = await vpop.getMarketCount();

      // Create commitments with different positions
      const positions = [
        1200n, // Far below
        1500n, // Below
        1600n, // Middle
        1700n, // Above
        1800n  // Far above
      ];
      const wagers = [
        ethers.parseEther("1"),
        ethers.parseEther("2"),
        ethers.parseEther("3"),
        ethers.parseEther("2"),
        ethers.parseEther("1")
      ];
      const nonces = positions.map(() => randomNonce64());
      const commitmentHashes = positions.map((pos, i) => createCommitmentHash(pos, wagers[i], nonces[i]));

      // Submit all commitments
      for (let i = 0; i < 5; i++) {
        await vpop.connect([owner, otherAccount, thirdAccount, owner, otherAccount][i])
          .commit(marketId, commitmentHashes[i], wagers[i], [], { value: wagers[i] });
      }

      // Move to reveal phase
      await time.increase(3601);

      // Reveal all commitments
      for (let i = 0; i < 5; i++) {
        await vpop.connect([owner, otherAccount, thirdAccount, owner, otherAccount][i])
          .reveal(marketId, i+1, commitmentHashes[i], positions[i], nonces[i]);
      }

      // Verify all commitments have been revealed
      const marketConsensusBeforeResolve   = await vpop.marketConsensus(marketId);
      expect(marketConsensusBeforeResolve.totalCommitments).to.equal(5);
      expect(marketConsensusBeforeResolve.revealedCommitments).to.equal(5);
      // Move to resolution phase
      await time.increase(3601);

      // Calculate winning threshold
      const threshold2 = await calculateWinningThreshold(vpop, marketId);

      // Resolve market
      await vpop.resolve(marketId, threshold2);

      // Get market consensus and threshold
      // const consensus = await vpop.getMarketConsensus(marketId);
      const marketConsensus = await vpop.marketConsensus(marketId);
      const consensus = marketConsensus.consensusPosition;
      const threshold = marketConsensus.winningThreshold;
      
      // Calculate distances from consensus
      const distances = positions.map(pos => 
        pos > consensus ? pos - consensus : consensus - pos
      );

      // Try to claim for each position
      for (let i = 0; i < 5; i++) {
        const distance = positions[i] > consensus ? positions[i] - consensus : consensus - positions[i];
        const isWinning = distance <= threshold;
        if (isWinning) {
          // Should succeed for winning positions
          await expect(vpop.connect([owner, otherAccount, thirdAccount, owner, otherAccount][i])
            .claim(marketId, i+1))
            .to.not.be.reverted;
        } else {
          // Should fail for non-winning positions
          await expect(vpop.connect([owner, otherAccount, thirdAccount, owner, otherAccount][i])
            .claim(marketId, i+1))
            .to.be.revertedWith("Not a winning position");
        }
      }

      // Verify winning positions received their winnings
      const totalWinnings = marketConsensus.totalWinnings;
      const totalWinningWagers = wagers.reduce((sum, wager, i) => 
        distances[i] <= threshold ? sum + wager : sum, 0n);

      for (let i = 0; i < 5; i++) {
        if (distances[i] <= threshold) {
          const expectedWinnings = (wagers[i] * totalWinnings) / totalWinningWagers;
          const balance = await ethers.provider.getBalance([owner, otherAccount, thirdAccount, owner, otherAccount][i].address);
          expect(balance).to.be.gt(0); // Should have received winnings
        }
      }
    });

    it("should not allow claiming before market resolution", async function () {
      // Create market and commitment
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        1000,
        2000,
        0,
        ethers.parseEther("0.1"),
        1,
        3600,
        3600,
        2000, // 20% winningPercentile
        "ipfs://threshold-test"
      );
      const marketId = await vpop.getMarketCount();

      const position = 1500n;
      const wager = ethers.parseEther("1");
      const nonce = randomNonce64();
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      const tx = await createCommit({
        vpopContract: vpop,
        marketId: marketId,
        signer: owner,
        position,
        wager,
        nonce
      });
      const receipt = await tx.wait();
      const event = receipt?.logs[0];

      await time.increase(3601);
      await vpop.reveal(marketId, 1, commitmentHash, position, nonce);

      // Try to claim before resolution
      await expect(vpop.claim(marketId, 1))
        .to.be.revertedWith("Market not resolved");
    });

    it("should not allow claiming unrevealed commitments", async function () {
      // Create market and commitment
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        1000,
        2000,
        0,
        ethers.parseEther("0.1"),
        1,
        3600,
        3600,
        2000, // 20% winningPercentile
        "ipfs://threshold-test"
      );
      const marketId = await vpop.getMarketCount();
     

      const position = 1500n;
      const wager = ethers.parseEther("1");
      const nonce = randomNonce64();
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      const tx = await createCommit({
        vpopContract: vpop,
        marketId: marketId,
        signer: owner,
        position,
        wager,
        nonce
      });
      const receipt = await tx.wait();
      const event = receipt?.logs[0];

      const position2 = 1600n;
      const wager2 = ethers.parseEther("1");
      const nonce2 = randomNonce64();
      const commitmentHash2 = createCommitmentHash(position2, wager2, nonce2);

      const tx2 = await createCommit({
        vpopContract: vpop,
        marketId: marketId,
        signer: owner,
        position: position2,
        wager: wager2,
        nonce: nonce2
      });
      const receipt2 = await tx2.wait();
      const event2 = receipt2?.logs[0];

      await time.increase(3601);
      await vpop.reveal(marketId, 2, commitmentHash2, position2, nonce2);
      await time.increase(7201); // Move past reveal phase
      const winningThreshold = await calculateWinningThreshold(vpop, marketId);
      await vpop.resolve(marketId, winningThreshold);
      // Try to claim unrevealed commitment
      await expect(vpop.claim(marketId, 1))
        .to.be.revertedWith("Commitment not revealed");
    });
    
    it("should send winnings to commitment creator regardless of who claims", async function () {
      // Create a market
      const marketId = await createMarket({
        vpopContract: vpop,
        signer: owner,
        lowerBound: 0n,
        upperBound: 1000n,
        decimals: 1,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 0,
        commitDuration: 3600,
        revealDuration: 3600,
        winningPercentile: 8000,
        ipfsHash: "ipfs://claim-test"
      });

      // Create commitment parameters
      const position = 500n;
      const wager = ethers.parseEther("1.0");
      const nonce = randomNonce64();
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment as owner
      const tx = await createCommit({
        vpopContract: vpop,
        marketId: marketId,
        signer: owner,
        position,
        wager,
        nonce
      });
      const receipt = await tx.wait();

      // Move to reveal phase
      await time.increase(3601);

      // Reveal commitment
      await vpop.reveal(marketId, 1, commitmentHash, position, nonce);

      // Move to resolution phase
      await time.increase(3601);

      // Calculate winning threshold and resolve market
      const threshold = await calculateWinningThreshold(vpop, marketId);
      await vpop.resolve(marketId, threshold);

      // Get initial balances
      const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
      const otherAccountBalanceBefore = await ethers.provider.getBalance(otherAccount.address);

      // Calculate expected winnings (accounting for fees)
      const feePercentage = 1600n; // 16% in basis points
      const totalFees = (wager * feePercentage) / 10000n;
      const expectedWinnings = wager - totalFees;

      // Have otherAccount claim the winnings
      const claimTx = await vpop.connect(otherAccount).claim(marketId, 1);
      const claimReceipt = await claimTx.wait();
      const gasUsed = claimReceipt.gasUsed;
      const gasPrice = claimReceipt.gasPrice;
      const gasCost = BigInt(gasUsed) * BigInt(gasPrice);

      // Get final balances
      const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
      const otherAccountBalanceAfter = await ethers.provider.getBalance(otherAccount.address);

      // Calculate actual received amounts
      const ownerReceived = ownerBalanceAfter - ownerBalanceBefore;
      const otherAccountReceived = otherAccountBalanceAfter - otherAccountBalanceBefore + gasCost;

      // Verify winnings went to owner (commitment creator)
      expect(ownerReceived).to.equal(expectedWinnings);
      // Verify otherAccount only paid gas (no winnings)
      expect(otherAccountReceived).to.equal(0n);
    });
  });

  describe("Whitelist", function () {
    it("Should allow creating market with whitelist", async function () {
      const whitelistRoot = ethers.keccak256(ethers.randomBytes(32));
      
      const marketParams = {
        token: ethers.ZeroAddress,
        lowerBound: ethers.parseEther("1"),
        upperBound: ethers.parseEther("10"),
        decimals: 18,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 20,
        commitDuration: 3600,
        revealDuration: 3600,
        winningPercentile: 50,
        ipfsHash: "QmTest123"
      };
      
      const tx = await vpop.initializeMarket(
        marketParams.token,
        marketParams.lowerBound,
        marketParams.upperBound,
        marketParams.decimals,
        marketParams.minWager,
        marketParams.decayFactor,
        marketParams.commitDuration,
        marketParams.revealDuration,
        marketParams.winningPercentile,
        marketParams.ipfsHash
      );

      const marketId = await vpop.getMarketCount();
      await vpop.updateWhitelistRoot(marketId, whitelistRoot);

      const rooty = await vpop.whitelistRoots(marketId);
      expect(rooty).to.equal(whitelistRoot);
    });

    it("Should verify whitelist correctly", async function () {
      // Create a whitelist with 7 addresses
      const addresses = [
        owner.address,
        otherAccount.address,
        thirdAccount.address,
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
        "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"
      ];
      
      // Create leaf nodes by hashing each address
      const leaves = addresses.map(addr => 
        ethers.keccak256(ethers.solidityPacked(["address"], [addr]))
      );

      // Construct Merkle Tree
      const tree = new MerkleTree(leaves, ethers.keccak256, {
        sortPairs: true,
      });

      // Get root
      const root = tree.getHexRoot();

      // Create market with whitelist
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        1000n,
        10000n,
        2,
        0, // ethers.parseEther("0.1"),
        20,
        3600,
        3600,
        50,
        "QmTest123"
      );

      const marketId = await vpop.getMarketCount();
      await vpop.updateWhitelistRoot(marketId, root);
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = randomNonce64();
      const wager = ethers.parseEther("0.5");
      const commitmentHash = createCommitmentHash(position, wager, nonce);
      
      // Test each whitelisted address
      for (const address of addresses) {
        const leaf = ethers.keccak256(ethers.solidityPacked(["address"], [address]));
        const proof = tree.getHexProof(leaf);
        const signer = await ethers.getSigner(address);
        
        // Should allow whitelisted address to commit
        const tx = await createCommit({
          vpopContract: vpop,
          marketId: marketId,
          signer: signer,
          position,
          wager,
          nonce,
          proof
        });
        const receipt = await tx.wait();
      }
      
      // Test non-whitelisted address
      const nonWhitelistedAddress = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
      const nonWhitelistedSigner = await ethers.getSigner(nonWhitelistedAddress);
      const wrongProof = [ethers.keccak256(ethers.randomBytes(32))];
      
      await expect(
        vpop.connect(nonWhitelistedSigner).commit(marketId, commitmentHash, wager, wrongProof, { value: wager })
      ).to.be.revertedWith("Address not whitelisted");
    });
  });

  describe("Zero Wager Markets", function () {
    it("Should allow external funding of prizes for zero wager market", async function () {
      // Create market with zero minWager
      const marketId = await createMarket({
        vpopContract: vpop,
        signer: owner,
        lowerBound: 1000n,
        upperBound: 10000n,
        decimals: 2,
        minWager: 0n,
        decayFactor: 20,
        ipfsHash: "QmTest123"
      });

      // Create a whitelist with the participating addresses
      const addresses = [owner.address, otherAccount.address];
      const leaves = addresses.map(addr => 
        ethers.keccak256(ethers.solidityPacked(["address"], [addr]))
      );

      // Construct Merkle Tree
      const tree = new MerkleTree(leaves, ethers.keccak256, {
        sortPairs: true,
      });

      // Get root and set whitelist
      const root = tree.getHexRoot();
      await vpop.updateWhitelistRoot(marketId, root);

      // Fund the market with ETH in multiple steps
      const firstPrizeAmount = ethers.parseEther("1.0");
      const secondPrizeAmount = ethers.parseEther("2.0");
      
      // First funding by owner
      await vpop.addWinnings(marketId, firstPrizeAmount, { value: firstPrizeAmount });
      let marketConsensus = await vpop.marketConsensus(marketId);
      expect(marketConsensus.totalWinnings).to.equal(firstPrizeAmount);

      // Second funding by other account
      await vpop.connect(otherAccount).addWinnings(marketId, secondPrizeAmount, { value: secondPrizeAmount });
      marketConsensus = await vpop.marketConsensus(marketId);
      expect(marketConsensus.totalWinnings).to.equal(firstPrizeAmount + secondPrizeAmount);

      // Try to fund with incorrect value
      await expect(
        vpop.connect(thirdAccount).addWinnings(marketId, ethers.parseEther("1.0"), { value: ethers.parseEther("0.5") })
      ).to.be.revertedWith("Sent value must match additional winnings");

      // Create commitment parameters
      const position = 5000n;
      const nonce = randomNonce64();
      const wager = 0n; // Zero wager for market initialization
      const whitelistWager = 100000n; // Contract overrides wager to this value for whitelisted markets
      // For whitelisted markets, hash must be calculated with the overridden wager since that's what gets stored
      const commitmentHash = createCommitmentHash(position, whitelistWager, nonce);

      // Create proof for whitelist
      const leaf = ethers.keccak256(ethers.solidityPacked(["address"], [owner.address]));
      const proof = tree.getHexProof(leaf);

      // Create commitment with zero wager and whitelist proof
      const tx = await createCommit({
        vpopContract: vpop,
        marketId: marketId,
        signer: owner,
        position,
        wager,
        nonce,
        proof
      });
      const receipt = await tx.wait();

      // Move to reveal phase
      await time.increase(3601);

      // Reveal commitment (use whitelistWager since that's what the contract stored)
      await vpop.reveal(marketId, 1, commitmentHash, position, nonce);

      // Verify commitment was revealed
      const commitment = await vpop.commitments(marketId, 1);
      expect(commitment.revealed).to.be.true;
      expect(commitment.position).to.equal(position);

      // Move to resolution phase
      await time.increase(3601);

      // Calculate winning threshold
      const threshold3 = await calculateWinningThreshold(vpop, marketId);

      // Resolve market
      await vpop.resolve(marketId, threshold3);

      // Claim winnings
      await vpop.claim(marketId, 1);

      // Verify winnings were claimed
      const finalBalance = await ethers.provider.getBalance(owner.address);
      expect(finalBalance).to.be.gt(0);
    });

    it("Should allow external funding with ERC20 tokens", async function () {
      // Deploy test token
      const TestToken = await ethers.getContractFactory("TestToken");
      const testToken = await TestToken.deploy();
      await testToken.waitForDeployment();
      const tokenAddress = await testToken.getAddress();
      
      // Create market with test token and zero minWager
      const marketId = await createMarket({
        vpopContract: vpop,
        signer: owner,
        token: tokenAddress,
        lowerBound: 1000n,
        upperBound: 10000n,
        decimals: 2,
        minWager: 0n,
        decayFactor: 20,
        ipfsHash: "QmTest123"
      });

      // Create a whitelist with the participating addresses
      const addresses = [owner.address, otherAccount.address];
      const leaves = addresses.map(addr => 
        ethers.keccak256(ethers.solidityPacked(["address"], [addr]))
      );

      // Construct Merkle Tree
      const tree = new MerkleTree(leaves, ethers.keccak256, {
        sortPairs: true,
      });

      // Get root and set whitelist
      const root = tree.getHexRoot();
      await vpop.updateWhitelistRoot(marketId, root);

      // Fund the market with tokens in multiple steps
      const firstPrizeAmount = ethers.parseEther("1.0");
      const secondPrizeAmount = ethers.parseEther("2.0");
      
      // First funding by owner
      await testToken.mint(owner.address, firstPrizeAmount + secondPrizeAmount);
      await testToken.approve(await vpop.getAddress(), firstPrizeAmount + secondPrizeAmount);
      
      await vpop.addWinnings(marketId, firstPrizeAmount, { value: 0 });
      let marketConsensus = await vpop.marketConsensus(marketId);
      expect(marketConsensus.totalWinnings).to.equal(firstPrizeAmount);

      // Second funding by other account
      await testToken.mint(otherAccount.address, secondPrizeAmount);
      await testToken.connect(otherAccount).approve(await vpop.getAddress(), secondPrizeAmount);
      await vpop.connect(otherAccount).addWinnings(marketId, secondPrizeAmount, { value: 0 });
      marketConsensus = await vpop.marketConsensus(marketId);
      expect(marketConsensus.totalWinnings).to.equal(firstPrizeAmount + secondPrizeAmount);

      // Try to fund with more tokens than approved
      await testToken.mint(thirdAccount.address, ethers.parseEther("1.0"));
      await testToken.connect(thirdAccount).approve(await vpop.getAddress(), ethers.parseEther("0.5")); // Only approve half
      await expect(
        vpop.connect(thirdAccount).addWinnings(marketId, ethers.parseEther("1.0"), { value: 0 })
      ).to.be.reverted;

      // Check contract's token balance
      const contractBalance = await testToken.balanceOf(await vpop.getAddress());
      expect(contractBalance).to.equal(firstPrizeAmount + secondPrizeAmount);
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = randomNonce64();
      const wager = 0n; // Zero wager for market initialization
      const whitelistWager = 100000n; // Contract overrides wager to this value for whitelisted markets
      // For whitelisted markets, hash must be calculated with the overridden wager since that's what gets stored
      const commitmentHash = createCommitmentHash(position, whitelistWager, nonce);

      // Create proof for whitelist
      const leaf = ethers.keccak256(ethers.solidityPacked(["address"], [owner.address]));
      const proof = tree.getHexProof(leaf);

      // Create commitment with zero wager and whitelist proof
      const tx = await createCommit({
        vpopContract: vpop,
        marketId: marketId,
        signer: owner,
        position,
        wager,
        nonce,
        proof
      });
      const receipt = await tx.wait();

      // Try to reveal before reveal phase
      await expect(
        vpop.reveal(marketId, 1, commitmentHash, position, nonce)
      ).to.be.revertedWith("Not in reveal phase");
      // Move to reveal phase
      await time.increase(3601);

      // Reveal commitment (use whitelistWager since that's what the contract stored)
      await vpop.reveal(marketId, 1, commitmentHash, position, nonce);

      // Move to resolution phase
      await time.increase(3601);

      // Calculate winning threshold
      const threshold4 = await calculateWinningThreshold(vpop, marketId);

      // Resolve market
      await vpop.resolve(marketId, threshold4);

      // Get balance before claim
      const balanceBefore = await testToken.balanceOf(owner.address);
      
      // Claim winnings
      await vpop.claim(marketId, 1);

      const finalMarketConsensus = await vpop.marketConsensus(marketId);
      const totalWinnings = finalMarketConsensus.totalWinnings;
      
      // Get balance after claim and verify the difference
      const balanceAfter = await testToken.balanceOf(owner.address);
      const balanceChange = balanceAfter - balanceBefore;
      
      // Verify the balance change equals the total winnings
      expect(balanceChange).to.equal(totalWinnings);
      expect(balanceChange).to.equal(firstPrizeAmount + secondPrizeAmount);
    });
  });

  describe("Market Creation Fee", function () {
    const marketCreateFee = ethers.parseEther("0.1"); // 0.1 ETH market creation fee

    it("Should allow owner to update market creation fee", async function () {
      const tx = await vpop.updatePlatformSettings(800, 200, 200, marketCreateFee, true);
      await tx.wait();
      
      const newFee = await vpop.marketCreateFee();
      expect(newFee).to.equal(marketCreateFee);
    });

    it("Should not allow non-owner to update market creation fee", async function () {
      await expect(
        vpop.connect(otherAccount).updatePlatformSettings(800, 200, 200, marketCreateFee, true)
      ).to.be.reverted;
    });

    it("Should allow market creation when correct fee is sent", async function () {
      const initialOwnerBalance = await ethers.provider.getBalance(owner.address);
      
      const tx = await vpop.connect(otherAccount).initializeMarket(
        ethers.ZeroAddress,
        0,
        100,
        1,
        ethers.parseEther("0.1"),
        20,
        3600,
        3600,
        50,
        "QmTest123",
        { value: marketCreateFee }
      );
      
      const receipt = await tx.wait();
      const finalOwnerBalance = await ethers.provider.getBalance(owner.address);

      // Check that owner received the fee
      expect(finalOwnerBalance - initialOwnerBalance).to.equal(marketCreateFee);
      
    });

    it("Should not allow market creation when insufficient fee is sent", async function () {
      const insufficientFee = ethers.parseEther("0.05"); // Half the required fee
      
      await expect(
        vpop.connect(otherAccount).initializeMarket(
          ethers.ZeroAddress,
          0,
          100,
          1,
          ethers.parseEther("0.1"),
          20,
          3600,
          3600,
          50,
          "QmTest123",
          { value: insufficientFee }
        )
      ).to.be.revertedWith("Market create fee not met");
    });

    it("Should not allow market creation when no fee is sent", async function () {
      await expect(
        vpop.connect(otherAccount).initializeMarket(
          ethers.ZeroAddress,
          0,
          100,
          1,
          ethers.parseEther("0.1"),
          20,
          3600,
          3600,
          50,
          "QmTest123"
        )
      ).to.be.revertedWith("Market create fee not met");
    });

    it("Should allow market creation when fee is set to 0", async function () {
      // First set fee to 0
      await vpop.updatePlatformSettings(800, 200, 200, 0, true);
      
      // Get initial market count
      const initialMarketCount = await vpop.getMarketCount();
      
      // Try creating market without fee
      const tx = await vpop.connect(otherAccount).initializeMarket(
        ethers.ZeroAddress,
        0,
        100,
        1,
        ethers.parseEther("0.1"),
        20,
        3600,
        3600,
        50,
        "QmTest123"
      );
      
      const receipt = await tx.wait();
      const finalMarketCount = await vpop.getMarketCount();
      
      // Verify market count increased by 1
      expect(finalMarketCount).to.equal(initialMarketCount + 1n);
    });
  });

  describe("Public Market Access", function () {
    it("Should allow public market creation when allowPublicMarkets is true", async function () {
      // Ensure allowPublicMarkets is true
      await vpop.updatePlatformSettings(800, 200, 200, 0, true);
      
      // Get initial market count
      const initialMarketCount = await vpop.getMarketCount();
      
      // Try creating market as non-owner
      const tx = await vpop.connect(otherAccount).initializeMarket(
        ethers.ZeroAddress,
        0,
        100,
        1,
        ethers.parseEther("0.1"),
        20,
        3600,
        3600,
        50,
        "QmTest123"
      );
      
      const receipt = await tx.wait();
      const finalMarketCount = await vpop.getMarketCount();
      
      // Verify market count increased by 1
      expect(finalMarketCount).to.equal(initialMarketCount + 1n);
    });

    it("Should only allow owner to create markets when allowPublicMarkets is false", async function () {
      // Set allowPublicMarkets to false
      await vpop.updatePlatformSettings(800, 200, 200, 0, false);
      
      // Try creating market as non-owner
      await expect(
        vpop.connect(otherAccount).initializeMarket(
          ethers.ZeroAddress,
          0,
          100,
          1,
          ethers.parseEther("0.1"),
          20,
          3600,
          3600,
          50,
          "QmTest123"
        )
      ).to.be.revertedWith("Only owner can create markets");

      // Verify owner can still create markets
      const initialMarketCount = await vpop.getMarketCount();
      
      const tx = await vpop.connect(owner).initializeMarket(
        ethers.ZeroAddress,
        0,
        100,
        1,
        ethers.parseEther("0.1"),
        20,
        3600,
        3600,
        50,
        "QmTest123"
      );
      
      const receipt = await tx.wait();
      const finalMarketCount = await vpop.getMarketCount();
      
      // Verify market count increased by 1
      expect(finalMarketCount).to.equal(initialMarketCount + 1n);
    });
  });
});




