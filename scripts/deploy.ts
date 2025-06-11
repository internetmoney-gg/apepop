import { ethers } from "hardhat";

async function main() {
  console.log("Deploying VPOP contract...");

  // Get the signer
  const [deployer] = await ethers.getSigners();
  console.log('Network:', await ethers.provider.getNetwork());
  console.log('Provider URL:', (ethers.provider as any).connection?.url || 'boof');
  console.log('Deployer address:', deployer.address);
  console.log('Deployer balance:', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'ETH');

  // Get the contract factory
  const VPOP = await ethers.getContractFactory("VPOP");

  // Estimate gas for deployment
  const deployTx = await VPOP.getDeployTransaction();
  const estimatedGas = await ethers.provider.estimateGas(deployTx);
  console.log("\nGas Estimation:");
  console.log("Estimated gas for deployment:", estimatedGas.toString());

  // Deploy the contract
  const vpop = await VPOP.connect(deployer).deploy();
  const deployReceipt = await vpop.waitForDeployment();
  const deployTxReceipt = await deployReceipt.deploymentTransaction()?.wait();

  console.log("\nDeployment Results:");
  console.log("Actual gas used:", deployTxReceipt?.gasUsed.toString());
  console.log("Gas price:", ethers.formatUnits(deployTxReceipt?.gasPrice || 0, "gwei"), "gwei");
  console.log("Total deployment cost:", ethers.formatEther((deployTxReceipt?.gasUsed || 0n) * (deployTxReceipt?.gasPrice || 0n)), "ETH");

  const address = await vpop.getAddress();
  console.log("\nVPOP deployed to:", address);

  // Log initial settings
  const platformFeeRate = await vpop.platformFeeRate();
  const creatorFeeRate = await vpop.creatorFeeRate();
  const apeFeeRate = await vpop.apeFeeRate();
  const apeOwner = await vpop.apeOwner();

  console.log("\nInitial settings:");
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
