import { useCallback } from 'react';

import { useSendMessage } from './useMessages';

export function useSendGif(
  conversationId: string,
  teamId: string,
  teamName: string,
  leagueId: string,
) {
  const sendMessage = useSendMessage(conversationId, teamId, teamName, leagueId);

  const sendGif = useCallback(
    (gifUrl: string) => {
      sendMessage.mutate({ content: gifUrl, type: 'gif' });
    },
    [sendMessage],
  );

  return { sendGif };
}
