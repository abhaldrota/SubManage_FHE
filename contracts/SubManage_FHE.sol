pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SubManage_FHE is ZamaEthereumConfig {
    struct Subscription {
        string id;
        euint32 encryptedPaymentAmount;
        uint256 publicData1;
        uint256 publicData2;
        address subscriber;
        uint256 renewalDate;
        bool isActive;
        uint32 decryptedPaymentAmount;
        bool isVerified;
    }

    mapping(string => Subscription) public subscriptions;
    string[] public subscriptionIds;

    event SubscriptionCreated(string indexed subId, address indexed subscriber);
    event PaymentVerified(string indexed subId, uint32 amount);

    constructor() ZamaEthereumConfig() {}

    function createSubscription(
        string calldata subId,
        externalEuint32 encryptedPaymentAmount,
        bytes calldata inputProof,
        uint256 publicData1,
        uint256 publicData2,
        uint256 renewalDate
    ) external {
        require(bytes(subscriptions[subId].id).length == 0, "Subscription exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedPaymentAmount, inputProof)), "Invalid encryption");

        subscriptions[subId] = Subscription({
            id: subId,
            encryptedPaymentAmount: FHE.fromExternal(encryptedPaymentAmount, inputProof),
            publicData1: publicData1,
            publicData2: publicData2,
            subscriber: msg.sender,
            renewalDate: renewalDate,
            isActive: true,
            decryptedPaymentAmount: 0,
            isVerified: false
        });

        FHE.allowThis(subscriptions[subId].encryptedPaymentAmount);
        FHE.makePubliclyDecryptable(subscriptions[subId].encryptedPaymentAmount);
        subscriptionIds.push(subId);

        emit SubscriptionCreated(subId, msg.sender);
    }

    function verifyPayment(
        string calldata subId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(subscriptions[subId].id).length > 0, "Subscription not found");
        require(!subscriptions[subId].isVerified, "Already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(subscriptions[subId].encryptedPaymentAmount);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        subscriptions[subId].decryptedPaymentAmount = decodedValue;
        subscriptions[subId].isVerified = true;

        emit PaymentVerified(subId, decodedValue);
    }

    function getEncryptedPayment(string calldata subId) external view returns (euint32) {
        require(bytes(subscriptions[subId].id).length > 0, "Subscription not found");
        return subscriptions[subId].encryptedPaymentAmount;
    }

    function getSubscription(string calldata subId) external view returns (
        uint256 publicData1,
        uint256 publicData2,
        address subscriber,
        uint256 renewalDate,
        bool isActive,
        bool isVerified,
        uint32 decryptedPaymentAmount
    ) {
        require(bytes(subscriptions[subId].id).length > 0, "Subscription not found");
        Subscription storage sub = subscriptions[subId];

        return (
            sub.publicData1,
            sub.publicData2,
            sub.subscriber,
            sub.renewalDate,
            sub.isActive,
            sub.isVerified,
            sub.decryptedPaymentAmount
        );
    }

    function getAllSubscriptionIds() external view returns (string[] memory) {
        return subscriptionIds;
    }

    function updateRenewalDate(string calldata subId, uint256 newDate) external {
        require(bytes(subscriptions[subId].id).length > 0, "Subscription not found");
        require(msg.sender == subscriptions[subId].subscriber, "Not subscriber");
        subscriptions[subId].renewalDate = newDate;
    }

    function cancelSubscription(string calldata subId) external {
        require(bytes(subscriptions[subId].id).length > 0, "Subscription not found");
        require(msg.sender == subscriptions[subId].subscriber, "Not subscriber");
        subscriptions[subId].isActive = false;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

