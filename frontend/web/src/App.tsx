import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface SubscriptionData {
  id: string;
  name: string;
  encryptedAmount: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
  category: string;
  status: string;
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
    status: "pending" as const, 
    message: "" 
  });
  const [newSubscriptionData, setNewSubscriptionData] = useState({ 
    name: "", 
    amount: "", 
    category: "streaming", 
    description: "" 
  });
  const [selectedSubscription, setSelectedSubscription] = useState<SubscriptionData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [userHistory, setUserHistory] = useState<any[]>([]);
  const [showFAQ, setShowFAQ] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
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
            encryptedAmount: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            category: Number(businessData.publicValue2) === 1 ? "streaming" : 
                     Number(businessData.publicValue2) === 2 ? "software" : "other",
            status: Number(businessData.publicValue1) === 1 ? "active" : "inactive"
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setSubscriptions(subscriptionsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
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
      const categoryValue = newSubscriptionData.category === "streaming" ? 1 : 
                           newSubscriptionData.category === "software" ? 2 : 3;
      
      const encryptedResult = await encrypt(contractAddress, address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newSubscriptionData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        1,
        categoryValue,
        newSubscriptionData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Encrypting subscription data..." });
      await tx.wait();
      
      setUserHistory(prev => [...prev, {
        type: "create",
        id: businessId,
        name: newSubscriptionData.name,
        timestamp: Date.now()
      }]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Subscription created with FHE protection!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewSubscriptionData({ name: "", amount: "", category: "streaming", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
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
        setTransactionStatus({ visible: true, status: "success", message: "Data verified on-chain" });
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying FHE decryption..." });
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      setUserHistory(prev => [...prev, {
        type: "decrypt",
        id: businessId,
        value: Number(clearValue),
        timestamp: Date.now()
      }]);
      
      await loadData();
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted with FHE!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
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
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "FHE system is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredSubscriptions = subscriptions.filter(sub => {
    const matchesSearch = sub.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         sub.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === "all" || sub.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const stats = {
    total: subscriptions.length,
    active: subscriptions.filter(s => s.status === "active").length,
    verified: subscriptions.filter(s => s.isVerified).length,
    totalAmount: subscriptions.reduce((sum, sub) => sum + (sub.isVerified ? sub.decryptedValue : 0), 0)
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE订阅管理 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>连接钱包开始使用</h2>
            <p>连接您的钱包来初始化FHE加密订阅管理系统</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>初始化FHE加密系统...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加载加密订阅数据...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE订阅管理 🔐</h1>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">检查系统状态</button>
          <button onClick={() => setShowFAQ(true)} className="faq-btn">常见问题</button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">+ 新增订阅</button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">总订阅数</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.active}</div>
            <div className="stat-label">活跃订阅</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">已验证</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">${stats.totalAmount}</div>
            <div className="stat-label">总金额</div>
          </div>
        </div>

        <div className="controls-section">
          <div className="search-filter">
            <input 
              type="text" 
              placeholder="搜索订阅..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <select 
              value={filterCategory} 
              onChange={(e) => setFilterCategory(e.target.value)}
              className="filter-select"
            >
              <option value="all">所有分类</option>
              <option value="streaming">流媒体</option>
              <option value="software">软件</option>
              <option value="other">其他</option>
            </select>
            <button onClick={loadData} className="refresh-btn">
              {isRefreshing ? "刷新中..." : "刷新数据"}
            </button>
          </div>
        </div>

        <div className="subscriptions-grid">
          {filteredSubscriptions.length === 0 ? (
            <div className="no-subscriptions">
              <p>未找到订阅</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                创建第一个订阅
              </button>
            </div>
          ) : (
            filteredSubscriptions.map((sub, index) => (
              <div 
                className={`subscription-card ${sub.isVerified ? 'verified' : ''}`}
                key={index}
                onClick={() => setSelectedSubscription(sub)}
              >
                <div className="card-header">
                  <h3>{sub.name}</h3>
                  <span className={`status-badge ${sub.status}`}>{sub.status}</span>
                </div>
                <div className="card-category">{sub.category}</div>
                <div className="card-description">{sub.description}</div>
                <div className="card-footer">
                  <div className="encryption-status">
                    {sub.isVerified ? (
                      <span className="verified-badge">✅ 已验证: ${sub.decryptedValue}</span>
                    ) : (
                      <span className="encrypted-badge">🔒 FHE加密中</span>
                    )}
                  </div>
                  <div className="card-date">{new Date(sub.timestamp * 1000).toLocaleDateString()}</div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="history-section">
          <h3>操作历史</h3>
          <div className="history-list">
            {userHistory.slice(-5).map((item, index) => (
              <div key={index} className="history-item">
                <span className="history-type">{item.type === 'create' ? '创建' : '解密'}</span>
                <span className="history-desc">{item.name || `值: ${item.value}`}</span>
                <span className="history-time">{new Date(item.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <CreateSubscriptionModal 
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

      {showFAQ && (
        <FAQModal onClose={() => setShowFAQ(false)} />
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

const CreateSubscriptionModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  subscriptionData: any;
  setSubscriptionData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, subscriptionData, setSubscriptionData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
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
      <div className="create-modal">
        <div className="modal-header">
          <h2>新增加密订阅</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE全同态加密保护</strong>
            <p>订阅金额将使用Zama FHE进行加密处理，保护您的财务隐私</p>
          </div>
          
          <div className="form-group">
            <label>订阅名称 *</label>
            <input 
              type="text" 
              name="name" 
              value={subscriptionData.name} 
              onChange={handleChange} 
              placeholder="输入订阅服务名称" 
            />
          </div>
          
          <div className="form-group">
            <label>月费金额 (整数) *</label>
            <input 
              type="number" 
              name="amount" 
              value={subscriptionData.amount} 
              onChange={handleChange} 
              placeholder="输入月费金额" 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE加密整数</div>
          </div>
          
          <div className="form-group">
            <label>分类 *</label>
            <select name="category" value={subscriptionData.category} onChange={handleChange}>
              <option value="streaming">流媒体</option>
              <option value="software">软件服务</option>
              <option value="other">其他</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>描述</label>
            <textarea 
              name="description" 
              value={subscriptionData.description} 
              onChange={handleChange} 
              placeholder="订阅描述..."
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !subscriptionData.name || !subscriptionData.amount} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "FHE加密中..." : "创建加密订阅"}
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
      <div className="detail-modal">
        <div className="modal-header">
          <h2>订阅详情</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="subscription-info">
            <div className="info-row">
              <span>服务名称:</span>
              <strong>{subscription.name}</strong>
            </div>
            <div className="info-row">
              <span>分类:</span>
              <strong>{subscription.category}</strong>
            </div>
            <div className="info-row">
              <span>状态:</span>
              <strong className={`status-${subscription.status}`}>{subscription.status}</strong>
            </div>
            <div className="info-row">
              <span>创建者:</span>
              <strong>{subscription.creator.substring(0, 8)}...{subscription.creator.substring(34)}</strong>
            </div>
            <div className="info-row">
              <span>创建时间:</span>
              <strong>{new Date(subscription.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-row">
              <span>描述:</span>
              <strong>{subscription.description}</strong>
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>FHE加密数据</h3>
            <div className="data-row">
              <div className="data-label">月费金额:</div>
              <div className="data-value">
                {subscription.isVerified ? 
                  `$${subscription.decryptedValue} (链上已验证)` : 
                  "🔒 FHE加密中"
                }
              </div>
              <button 
                className={`decrypt-btn ${subscription.isVerified ? 'verified' : ''}`}
                onClick={decryptData} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "解密中..." : 
                 subscription.isVerified ? "✅ 已验证" : "🔓 验证解密"}
              </button>
            </div>
            
            <div className="fhe-explanation">
              <h4>FHE保护流程</h4>
              <div className="flow-steps">
                <div className="flow-step">
                  <div className="step-number">1</div>
                  <div className="step-content">客户端加密金额数据</div>
                </div>
                <div className="flow-step">
                  <div className="step-number">2</div>
                  <div className="step-content">加密数据存储到链上</div>
                </div>
                <div className="flow-step">
                  <div className="step-number">3</div>
                  <div className="step-content">需要时进行离线解密验证</div>
                </div>
                <div className="flow-step">
                  <div className="step-number">4</div>
                  <div className="step-content">提交证明完成链上验证</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">关闭</button>
        </div>
      </div>
    </div>
  );
};

const FAQModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const faqs = [
    {
      question: "什么是FHE全同态加密？",
      answer: "FHE允许在加密数据上直接进行计算，无需解密，保护您的订阅数据隐私。"
    },
    {
      question: "为什么需要加密订阅数据？",
      answer: "防止服务商获取您的完整消费习惯，保护财务隐私。"
    },
    {
      question: "解密过程安全吗？",
      answer: "解密在本地进行，只有验证证明会上链，确保安全性。"
    }
  ];

  return (
    <div className="modal-overlay">
      <div className="faq-modal">
        <div className="modal-header">
          <h2>常见问题</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          {faqs.map((faq, index) => (
            <div key={index} className="faq-item">
              <h3>{faq.question}</h3>
              <p>{faq.answer}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default App;