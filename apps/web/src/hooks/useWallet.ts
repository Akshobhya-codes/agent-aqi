"use client";

import { useCallback, useEffect, useState } from "react";

export const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_HEX = "0x14a34";

// Minimal EIP-1193 provider type
type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

function getProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown) as { ethereum?: Eip1193Provider }).ethereum ?? null;
}

export interface WalletState {
  address:    string | null;
  chainId:    number | null;
  connecting: boolean;
  error:      string | null;
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    address: null, chainId: null, connecting: false, error: null,
  });

  // Sync on mount + subscribe to provider events
  useEffect(() => {
    const provider = getProvider();
    if (!provider) return;

    const handleAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setState((s) => ({ ...s, address: accounts[0] ?? null }));
    };

    const handleChainChanged = (...args: unknown[]) => {
      const chainId = args[0] as string;
      setState((s) => ({ ...s, chainId: parseInt(chainId, 16) }));
    };

    provider.on?.("accountsChanged", handleAccounts);
    provider.on?.("chainChanged",    handleChainChanged);

    // Read initial state (non-blocking — already connected accounts only)
    void provider.request({ method: "eth_accounts" }).then((res) => {
      const accounts = res as string[];
      if (accounts.length > 0) setState((s) => ({ ...s, address: accounts[0] ?? null }));
    }).catch(() => { /* no wallet yet */ });

    void provider.request({ method: "eth_chainId" }).then((res) => {
      setState((s) => ({ ...s, chainId: parseInt(res as string, 16) }));
    }).catch(() => { /* ignore */ });

    return () => {
      provider.removeListener?.("accountsChanged", handleAccounts);
      provider.removeListener?.("chainChanged",    handleChainChanged);
    };
  }, []);

  const connect = useCallback(async () => {
    const provider = getProvider();
    if (!provider) {
      setState((s) => ({ ...s, error: "No wallet detected. Please install MetaMask." }));
      return;
    }
    setState((s) => ({ ...s, connecting: true, error: null }));
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const chainId  = parseInt((await provider.request({ method: "eth_chainId" })) as string, 16);
      setState({ address: accounts[0] ?? null, chainId, connecting: false, error: null });
    } catch (err) {
      setState((s) => ({ ...s, connecting: false, error: String(err) }));
    }
  }, []);

  const switchToBaseSepolia = useCallback(async () => {
    const provider = getProvider();
    if (!provider) return;
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BASE_SEPOLIA_HEX }],
      });
    } catch (err) {
      // Error 4902 = chain not yet added to the wallet
      if ((err as { code?: number }).code === 4902) {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId:         BASE_SEPOLIA_HEX,
            chainName:       "Base Sepolia Testnet",
            nativeCurrency:  { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls:         ["https://sepolia.base.org"],
            blockExplorerUrls: ["https://sepolia.basescan.org"],
          }],
        });
      }
    }
  }, []);

  return { ...state, connect, switchToBaseSepolia, BASE_SEPOLIA_CHAIN_ID };
}
