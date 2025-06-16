// import { HardhatUserConfig } from "hardhat/config";
// import "@nomicfoundation/hardhat-toolbox";

// const config: HardhatUserConfig = {
//   solidity: "0.8.28",
// };

// export default config;


require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();


// const INFURA_API_KEY = process.env.INFURA_KEY;
// SEPOLIA_PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY;
// SEPOLIA_PROTOCOL_PRIVATE_KEY = process.env.SEPOLIA_PROTOCOL_PRIVATE_KEY;

// MAINNET_PRIVATE_KEY = process.env.MAINNET_PRIVATE_KEY;

// console.log('process.env.MAINNET_PRIVATE_KEY: ',process.env.MAINNET_PRIVATE_KEY)


/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true
    }
  },
  // allowUnlimitedContractSize: true,
  networks: {
    localhost: {
      // forking: {
      //   url: `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
      // },
      // chainId: 33139,
      cors: true,
      chainId: 31337,
      gasPrice: 2000000000,
      allowUnlimitedContractSize: true,      
    },
    
    curtis: {
      url: "https://curtis.rpc.caldera.xyz/http",
      chainId: 33111,
      accounts: [process.env.CURTIS_PRIVATE_KEY],
    },
    
    apechain: {
      url: "https://rpc.apechain.com",
      // url: "https://apechain.drpc.org",
      chainId: 33139,
      accounts: [process.env.APECHAIN_PRIVATE_KEY],
    },

  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  ignition: {
    strategyConfig: {
      create2: {
        salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
  },
};