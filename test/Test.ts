import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import hre from "hardhat";
import { ethers } from "hardhat";

describe("VPOP", function () {
  // We define a fixture to reuse the same setup in every test.
  async function deployVPOPFixture() {
    const [owner, otherAccount] = await hre.ethers.getSigners();

    const VPOP = await hre.ethers.getContractFactory("VPOP");
    const vpop = await VPOP.deploy();

    return { vpop, owner, otherAccount };
  }

  describe("Market Creation", function () {
    it("Should create a market with correct parameters", async function () {
      const { vpop, owner } = await deployVPOPFixture();

      const marketParams = {
        lowerBound: ethers.parseEther("1"),
        upperBound: ethers.parseEther("10"),
        decimals: 18,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 20,
        commitDuration: 3600, // 1 hour
        revealDuration: 3600, // 1 hour
        percentile: 50,
        ipfsHash: "QmTest123"
      };

      // Create the market
      const tx = await vpop.initializeMarket(
        marketParams.lowerBound,
        marketParams.upperBound,
        marketParams.decimals,
        marketParams.minWager,
        marketParams.decayFactor,
        marketParams.commitDuration,
        marketParams.revealDuration,
        marketParams.percentile,
        marketParams.ipfsHash
      );

      // Get the market ID from the event
      const receipt = await tx.wait();
      const event = receipt?.logs[0];
      const marketId = event?.topics[1]; // The marketId is in the first indexed parameter

      // Verify the market was created correctly
      const market = await vpop.markets(1n); // Use BigInt for market ID
      expect(market.creator).to.equal(owner.address);
      expect(market.lowerBound).to.equal(marketParams.lowerBound);
      expect(market.upperBound).to.equal(marketParams.upperBound);
      expect(market.decimals).to.equal(marketParams.decimals);
      expect(market.minWager).to.equal(marketParams.minWager);
      expect(market.decayFactor).to.equal(marketParams.decayFactor);
      expect(market.commitDuration).to.equal(marketParams.commitDuration);
      expect(market.revealDuration).to.equal(marketParams.revealDuration);
      expect(market.percentile).to.equal(marketParams.percentile);
      expect(market.ipfsHash).to.equal(marketParams.ipfsHash);
    });

    it("Should fail when creating a market with invalid parameters", async function () {
      const { vpop } = await deployVPOPFixture();

      const marketParams = {
        lowerBound: ethers.parseEther("10"), // Higher than upperBound
        upperBound: ethers.parseEther("1"),  // Lower than lowerBound
        decimals: 19, // Invalid decimals
        minWager: 0, // Invalid minWager
        decayFactor: 0, // Invalid decayFactor
        commitDuration: 0, // Invalid commitDuration
        revealDuration: 0, // Invalid revealDuration
        percentile: 101, // Invalid percentile
        ipfsHash: "" // Empty IPFS hash
      };

      await expect(
        vpop.initializeMarket(
          marketParams.lowerBound,
          marketParams.upperBound,
          marketParams.decimals,
          marketParams.minWager,
          marketParams.decayFactor,
          marketParams.commitDuration,
          marketParams.revealDuration,
          marketParams.percentile,
          marketParams.ipfsHash
        )
      ).to.be.revertedWith("Lower bound must be less than upper bound");
    });

    it("Should increment market counter correctly", async function () {
      const { vpop } = await deployVPOPFixture();

      // Create first market
      await vpop.initializeMarket(
        ethers.parseEther("1"),
        ethers.parseEther("10"),
        18,
        ethers.parseEther("0.1"),
        10,
        3600,
        3600,
        50,
        "QmTest1"
      );

      // Create second market
      await vpop.initializeMarket(
        ethers.parseEther("1"),
        ethers.parseEther("10"),
        18,
        ethers.parseEther("0.1"),
        10,
        3600,
        3600,
        50,
        "QmTest2"
      );

      // Check market count
      expect(await vpop.getMarketCount()).to.equal(3); // Starting from 1
    });
  });

  describe("Commitments", function () {
    it("Should create a commitment with correct parameters", async function () {
      const { vpop, owner } = await deployVPOPFixture();

      // Create a market first
      await vpop.initializeMarket(
        ethers.parseEther("1"),
        ethers.parseEther("10"),
        18,
        ethers.parseEther("0.1"),
        20,
        3600,
        3600,
        50,
        "QmTest123"
      );

      const commitmentHash = ethers.keccak256(ethers.toUtf8Bytes("test commitment"));
      const wager = ethers.parseEther("0.5");

      // Create commitment
      const tx = await vpop.commit(1, commitmentHash, wager);
      const receipt = await tx.wait();
      const event = receipt?.logs[0];

      // Verify commitment was created
      const commitment = await vpop.commitments(1, 1); // marketId 1, commitmentId 1
      expect(commitment.commitmentHash).to.equal(commitmentHash);
      expect(commitment.wager).to.equal(wager);
      expect(commitment.revealed).to.be.false;
    });

    it("Should fail when creating commitment for non-existent market", async function () {
      const { vpop } = await deployVPOPFixture();
      const commitmentHash = ethers.keccak256(ethers.toUtf8Bytes("test commitment"));
      const wager = ethers.parseEther("0.5");

      await expect(
        vpop.commit(999, commitmentHash, wager)
      ).to.be.revertedWith("Market does not exist");
    });

    it("Should fail when wager is below minimum", async function () {
      const { vpop } = await deployVPOPFixture();

      // Create a market with minWager of 0.1 ETH
      await vpop.initializeMarket(
        ethers.parseEther("1"),
        ethers.parseEther("10"),
        18,
        ethers.parseEther("0.1"),
        20,
        3600,
        3600,
        50,
        "QmTest123"
      );

      const commitmentHash = ethers.keccak256(ethers.toUtf8Bytes("test commitment"));
      const wager = ethers.parseEther("0.05"); // Below minimum wager

      await expect(
        vpop.commit(1, commitmentHash, wager)
      ).to.be.revertedWith("Weight below minimum wager");
    });

    it("Should fail when commitment phase has ended", async function () {
      const { vpop } = await deployVPOPFixture();

      // Create a market with 1 hour commit duration
      await vpop.initializeMarket(
        ethers.parseEther("1"),
        ethers.parseEther("10"),
        18,
        ethers.parseEther("0.1"),
        20,
        3600, // 1 hour
        3600,
        50,
        "QmTest123"
      );

      // Advance time by 2 hours
      await time.increase(7200);

      const commitmentHash = ethers.keccak256(ethers.toUtf8Bytes("test commitment"));
      const wager = ethers.parseEther("0.5");

      await expect(
        vpop.commit(1, commitmentHash, wager)
      ).to.be.revertedWith("Commitment phase has ended");
    });

    it("Should increment commitment counter correctly", async function () {
      const { vpop } = await deployVPOPFixture();

      // Create a market
      await vpop.initializeMarket(
        ethers.parseEther("1"),
        ethers.parseEther("10"),
        18,
        ethers.parseEther("0.1"),
        20,
        3600,
        3600,
        50,
        "QmTest123"
      );

      const commitmentHash1 = ethers.keccak256(ethers.toUtf8Bytes("commitment 1"));
      const commitmentHash2 = ethers.keccak256(ethers.toUtf8Bytes("commitment 2"));
      const wager = ethers.parseEther("0.5");

      // Create two commitments
      await vpop.commit(1, commitmentHash1, wager);
      await vpop.commit(1, commitmentHash2, wager);

      // Verify commitment count
      expect(await vpop.marketCommitmentCount(1)).to.equal(2);
    });
  });
});







