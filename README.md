# EVM Bytecodes Check

Evaluate Ethereum Virtual Machine (EVM) blockchain smart contracts for similar bytecodes, identifying duplicates across contracts.

## Table of Contents
- [About the Project](#about-the-project)
- [Installation](#installation)
- [Usage](#usage)
- [Features](#features)
- [Contribution](#contribution)
- [Acknowledgments](#acknowledgments)
- [License](#license)

## About the Project

EVM Bytecodes Check is a specialized tool designed to analyze smart contracts on the EVM blockchain for duplicate bytecodes. By efficiently managing requests with rate limiting and leveraging a local SQLite database, it provides a robust solution for contract evaluation.

## Installation

1. Clone the repository or download the `sc_checker.js` file.
2. Install the required dependencies:
   ```bash
   npm install sqlite3 ethers@5.7.2 fs-extra bottleneck progress
   ```

## Usage

1. Create a file named `addresses.txt` in the same folder as the script. Add the contract addresses you want to analyze, one address per line.
2. Create a `secrets.json` file in the same folder with your Ethereum provider endpoint and Etherscan API key. Example format:
   ```json
   {
     "providerEndpoint": "YOUR_PROVIDER_ENDPOINT",
     "ethApiKey": "YOUR_ETHERSCAN_API_KEY"
   }
   ```
3. Run the script to start the evaluation:
   ```bash
   node sc_checker.js
   ```

The script will read the contract addresses from the `addresses.txt` file, utilize the configurations from `secrets.json`, and evaluate the contracts, checking for duplicate bytecodes and providing progress updates.

## Features

- **Database Management**: Utilizes SQLite for efficient storage and retrieval of bytecodes.
- **Rate Limiting**: Manages request rates to adhere to Etherscan API limits.
- **Etherscan Integration**: Fetches transactions and bytecodes from the Ethereum network using Etherscan.
- **Robust Error Handling**: Implements comprehensive error handling and logging.

## Contribution

Contributions are welcome! Feel free to submit issues or pull requests.

## Acknowledgments

Special thanks to the developers and maintainers of the libraries used in this project.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
