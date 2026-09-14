import { atom } from "nanostores";

export const selectedSidebarChatbot = atom(null);
export const sourcesForSelectedMessage = atom([]);
export const newChatTrigger = atom(0); // Increment to trigger new chat
