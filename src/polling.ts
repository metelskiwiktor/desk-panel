import { createContext, useContext } from 'react';

/** A mounted but hidden dashboard retains state without doing background reads. */
export const PollingContext = createContext(true);
export const usePollingEnabled = () => useContext(PollingContext);
