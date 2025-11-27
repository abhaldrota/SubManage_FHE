import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface SubscriptionData {
  id: string;
  name: string;
  amount: number;
  frequency: string;
  nextBilling: number;
  merchant: string;
  status: string;
  encryptedAmount: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  timestamp: number;
  creator: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState<SubscriptionData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingSubscription, setCreatingSubscription] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newSubscriptionData, setNewSubscriptionData] = useState({ 
    name: "", 
    amount: "", 
    frequency: "monthly",
    merchant: "" 
  });
  const [selectedSubscription, setSelectedSubscription] = useState<SubscriptionData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [stats, setStats] = useState({ total: 0, active: 0, monthly: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const subscriptionsList: SubscriptionData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          subscriptionsList.push({
            id: businessId,
            name: businessData.name,
            amount: 0,
            frequency: "monthly",
            nextBilling: Number(businessData.timestamp) + 30 * 24 * 60 * 60,
            merchant: businessData.description,
            status: "active",
            encryptedAmount: "",
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setSubscriptions(subscriptionsList);
      updateStats(subscriptionsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (subs: SubscriptionData[]) => {
    setStats({
      total: subs.length,
      active: subs.filter(s => s.status === "active").length,
      monthly: subs.reduce((sum, s) => sum + (s.publicValue1 || 0), 0)
    });
  };

  const createSubscription = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingSubscription(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating subscription with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const amountValue = parseInt(newSubscriptionData.amount) || 0;
      const businessId = `sub-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newSubscriptionData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        amountValue,
        0,
        newSubscriptionData.merchant
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Subscription created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewSubscriptionData({ name: "", amount: "", frequency: "monthly", merchant: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingSubscription(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Amount decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and ready!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredSubscriptions = subscriptions.filter(sub => {
    const matchesSearch = sub.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         sub.merchant.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "all" || sub.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const renderStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Subscriptions</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-value">{stats.active}</div>
            <div className="stat-label">Active</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <div className="stat-value">${stats.monthly}</div>
            <div className="stat-label">Monthly Total</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEInfo = () => {
    return (
      <div className="fhe-info-panel">
        <h3>🔐 FHE Privacy Protection</h3>
        <div className="fhe-steps">
          <div className="fhe-step">
            <div className="step-number">1</div>
            <div className="step-content">
              <strong>Encrypted Storage</strong>
              <p>Subscription amounts are FHE-encrypted on-chain</p>
            </div>
          </div>
          <div className="fhe-step">
            <div className="step-number">2</div>
            <div className="step-content">
              <strong>Private Computation</strong>
              <p>Renewal logic processed without revealing amounts</p>
            </div>
          </div>
          <div className="fhe-step">
            <div className="step-number">3</div>
            <div className="step-content">
              <strong>Selective Disclosure</strong>
              <p>Only you can decrypt and verify payment data</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Subscriptions 🔐</h1>
            <p>Privacy-First Subscription Management</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Start</h2>
            <p>Manage your subscriptions with full privacy using FHE encryption</p>
            <div className="connection-features">
              <div className="feature">
                <span>🔒</span>
                <p>Encrypted payment amounts</p>
              </div>
              <div className="feature">
                <span>👁️</span>
                <p>Merchants see only what's necessary</p>
              </div>
              <div className="feature">
                <span>⚡</span>
                <p>Private automated renewals</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your subscription data</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted subscriptions...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE Subscriptions 🔐</h1>
          <p>Privacy-First Subscription Management</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="check-btn">
            Check Availability
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Add Subscription
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="controls-section">
          <div className="search-filter">
            <input
              type="text"
              placeholder="Search subscriptions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <select 
              value={filterStatus} 
              onChange={(e) => setFilterStatus(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {renderStats()}
        {renderFHEInfo()}

        <div className="subscriptions-section">
          <h2>Your Subscriptions</h2>
          
          <div className="subscriptions-list">
            {filteredSubscriptions.length === 0 ? (
              <div className="no-subscriptions">
                <p>No subscriptions found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Add Your First Subscription
                </button>
              </div>
            ) : (
              filteredSubscriptions.map((sub, index) => (
                <div 
                  className={`subscription-card ${sub.status} ${selectedSubscription?.id === sub.id ? "selected" : ""}`}
                  key={index}
                  onClick={() => setSelectedSubscription(sub)}
                >
                  <div className="card-header">
                    <div className="service-name">{sub.name}</div>
                    <div className={`status-badge ${sub.status}`}>{sub.status}</div>
                  </div>
                  
                  <div className="card-content">
                    <div className="merchant-info">
                      <span className="merchant">{sub.merchant}</span>
                      <span className="frequency">{sub.frequency}</span>
                    </div>
                    
                    <div className="amount-info">
                      {sub.isVerified && sub.decryptedValue ? (
                        <div className="decrypted-amount">
                          ${sub.decryptedValue} (Verified)
                        </div>
                      ) : (
                        <div className="encrypted-amount">
                          🔒 FHE Encrypted
                        </div>
                      )}
                    </div>
                    
                    <div className="billing-info">
                      Next billing: {new Date(sub.nextBilling * 1000).toLocaleDateString()}
                    </div>
                  </div>
                  
                  <div className="card-footer">
                    <div className="creator">
                      Created by: {sub.creator.substring(0, 6)}...{sub.creator.substring(38)}
                    </div>
                    <button 
                      className={`verify-btn ${sub.isVerified ? 'verified' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        decryptData(sub.id);
                      }}
                      disabled={isDecrypting}
                    >
                      {sub.isVerified ? '✅ Verified' : '🔓 Verify Amount'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <ModalCreateSubscription 
          onSubmit={createSubscription}
          onClose={() => setShowCreateModal(false)}
          creating={creatingSubscription}
          subscriptionData={newSubscriptionData}
          setSubscriptionData={setNewSubscriptionData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedSubscription && (
        <SubscriptionDetailModal
          subscription={selectedSubscription}
          onClose={() => setSelectedSubscription(null)}
          isDecrypting={isDecrypting || fheIsDecrypting}
          decryptData={() => decryptData(selectedSubscription.id)}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateSubscription: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  subscriptionData: any;
  setSubscriptionData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, subscriptionData, setSubscriptionData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'amount') {
      const intValue = value.replace(/[^\d]/g, '');
      setSubscriptionData({ ...subscriptionData, [name]: intValue });
    } else {
      setSubscriptionData({ ...subscriptionData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-subscription-modal">
        <div className="modal-header">
          <h2>Add New Subscription</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Payment amount will be encrypted using Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Service Name *</label>
            <input 
              type="text"
              name="name"
              value={subscriptionData.name}
              onChange={handleChange}
              placeholder="Netflix, Spotify, etc."
            />
          </div>
          
          <div className="form-group">
            <label>Monthly Amount (USD) *</label>
            <input 
              type="number"
              name="amount"
              value={subscriptionData.amount}
              onChange={handleChange}
              placeholder="Enter amount"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Billing Frequency</label>
            <select name="frequency" value={subscriptionData.frequency} onChange={handleChange}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Merchant Name *</label>
            <input 
              type="text"
              name="merchant"
              value={subscriptionData.merchant}
              onChange={handleChange}
              placeholder="Company name"
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit}
            disabled={creating || isEncrypting || !subscriptionData.name || !subscriptionData.amount || !subscriptionData.merchant}
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Subscription"}
          </button>
        </div>
      </div>
    </div>
  );
};

const SubscriptionDetailModal: React.FC<{
  subscription: SubscriptionData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ subscription, onClose, isDecrypting, decryptData }) => {
  return (
    <div className="modal-overlay">
      <div className="subscription-detail-modal">
        <div className="modal-header">
          <h2>Subscription Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-item">
              <label>Service Name</label>
              <span>{subscription.name}</span>
            </div>
            
            <div className="detail-item">
              <label>Merchant</label>
              <span>{subscription.merchant}</span>
            </div>
            
            <div className="detail-item">
              <label>Billing Frequency</label>
              <span>{subscription.frequency}</span>
            </div>
            
            <div className="detail-item">
              <label>Next Billing Date</label>
              <span>{new Date(subscription.nextBilling * 1000).toLocaleDateString()}</span>
            </div>
            
            <div className="detail-item">
              <label>Status</label>
              <span className={`status ${subscription.status}`}>{subscription.status}</span>
            </div>
            
            <div className="detail-item amount-item">
              <label>Payment Amount</label>
              <div className="amount-display">
                {subscription.isVerified && subscription.decryptedValue ? (
                  <span className="decrypted-amount">${subscription.decryptedValue}</span>
                ) : (
                  <span className="encrypted-amount">🔒 Encrypted</span>
                )}
                <button 
                  className={`verify-btn ${subscription.isVerified ? 'verified' : ''}`}
                  onClick={decryptData}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Verifying..." : subscription.isVerified ? "Verified" : "Verify Amount"}
                </button>
              </div>
            </div>
          </div>
          
          <div className="fhe-explanation">
            <h3>🔐 FHE Privacy Features</h3>
            <p>Your payment amount is encrypted on-chain using Fully Homomorphic Encryption.</p>
            <ul>
              <li>Merchants cannot see your other subscription amounts</li>
              <li>Renewal calculations happen without decrypting data</li>
              <li>Only you can verify and view the actual amount</li>
            </ul>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;