import { ethers } from "hardhat";

async function main() {
  console.log("Deploying VPOP contract...");

  // Get the signer
  const [deployer] = await ethers.getSigners();
  console.log('deployer: ',deployer);
  console.log("Deploying with account:", deployer.address);

  // Get the contract factory
  const VPOP = await ethers.getContractFactory("VPOP");

  // Deploy the contract
  const vpop = await VPOP.connect(deployer).deploy();
  await vpop.waitForDeployment();

  const address = await vpop.getAddress();
  console.log("VPOP deployed to:", address);

  // Log initial settings
  const platformFeeRate = await vpop.platformFeeRate();
  const creatorFeeRate = await vpop.creatorFeeRate();
  const apeFeeRate = await vpop.apeFeeRate();
  const apeOwner = await vpop.apeOwner();

  console.log("Initial settings:");
  console.log("Platform fee rate:", platformFeeRate.toString(), "basis points");
  console.log("Creator fee rate:", creatorFeeRate.toString(), "basis points");
  console.log("Ape fee rate:", apeFeeRate.toString(), "basis points");
  console.log("Ape owner address:", apeOwner);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
