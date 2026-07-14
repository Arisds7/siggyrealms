"use client";

import { useEffect, useState, useCallback } from "react";

export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: {
    request: (args: { method: string; params?: any[] }) => Promise<any>;
    on: (event: string, handler: any) => void;
    removeListener: (event: string, handler: any) => void;
  };
}

export function useEIP6963() {
  const [providers, setProviders] = useState<EIP6963ProviderDetail[]>([]);
  const [discoveryComplete, setDiscoveryComplete] = useState(false);

  useEffect(() => {
    let mounted = true;
    const providersMap = new Map<string, EIP6963ProviderDetail>();

    const handleAnnounce = (event: CustomEvent<EIP6963ProviderDetail>) => {
      if (mounted) {
        providersMap.set(event.detail.info.uuid, event.detail);
        setProviders(Array.from(providersMap.values()));
      }
    };

    // Listen for provider announcements
    window.addEventListener("eip6963:announceProvider", handleAnnounce as EventListener);

    // Request providers to announce themselves
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // Set timeout for discovery completion
    const timeout = setTimeout(() => {
      if (mounted) {
        setDiscoveryComplete(true);
      }
    }, 500);

    return () => {
      mounted = false;
      window.removeEventListener("eip6963:announceProvider", handleAnnounce as EventListener);
      clearTimeout(timeout);
    };
  }, []);

  const getProvider = useCallback((uuid: string) => {
    return providers.find((p) => p.info.uuid === uuid);
  }, [providers]);

  return { providers, discoveryComplete, getProvider };
}
